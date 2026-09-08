// Apply this branch's unapplied migrations to a live database inside a
// transaction, then roll it back and prove nothing stayed.
//
//   REHEARSAL_TARGET_DB_URL=... REHEARSAL_EXPECTED_PROJECT_REF=... npx tsx reference/run-rehearsal.ts
//
// Why this exists. A throwaway-Postgres job applies every migration to an EMPTY
// database, so it cannot see any failure that needs rows. Three of the four
// failure classes are therefore invisible to any offline gate. This runner is
// what makes them block a pull request instead of surfacing on the merge
// commit, and it writes nothing to do it.
//
// WHAT MAKES IT SAFE, in the order the run applies it:
//
//   1. It refuses a target that is not the expected project, before dialling.
//      Production is never a rehearsal target, and the refusal is the only guard
//      there is: once a log line names the database reached, it has been.
//   2. It refuses any migration carrying transaction control, before dialling.
//   3. It opens a savepoint and rolls back TO it, so a COMMIT that slipped past
//      guard 2 makes that statement fail loudly instead of passing silently.
//   4. It counts the target's public objects before and after, so the rollback
//      is measured rather than trusted.
//
// It never prints a connection string, a password or a key: only the project
// reference and the host.
//
// Every decision lives in rehearsal.ts and is unit-tested. This file is the IO,
// because a module that calls `main()` at import time cannot be imported by a
// test without running the job.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

import {
  type Finding,
  envRefusal,
  exitCode,
  fail,
  isLoopback,
  loopbackOverride,
  normaliseError,
  ok,
  preDialFindings,
  rehearsal,
  render,
  targetFindings,
} from './rehearsal.js';

const MIGRATIONS_DIR = process.env.REHEARSAL_MIGRATIONS_DIR ?? 'supabase/migrations';
const DIR = path.resolve(process.cwd(), MIGRATIONS_DIR);

function migrationFiles(): string[] {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'));
}

function readMigration(file: string): string {
  return fs.readFileSync(path.join(DIR, file), 'utf8');
}

/**
 * TLS on, always, except against loopback.
 *
 * A throwaway container's certificate is self-signed and its database is
 * destroyed with the job. A real target never gets the exception, because
 * turning verification off there sends the database password across the network
 * in the clear.
 */
function sslFor(url: string): pg.ClientConfig['ssl'] {
  try {
    return isLoopback(new URL(url).hostname) ? false : { rejectUnauthorized: true };
  } catch {
    return { rejectUnauthorized: true };
  }
}

async function main(): Promise<number> {
  const url = process.env.REHEARSAL_TARGET_DB_URL;
  const expectedRef = process.env.REHEARSAL_EXPECTED_PROJECT_REF;
  // Resolved against an empty string when the URL is missing, which cannot be
  // allowed, so the refusal below still fires first.
  const override = loopbackOverride(process.argv.slice(2), url ?? '');
  const refusal = envRefusal({ targetDbUrl: url, expectedRef }, override);
  if (refusal || !url) {
    console.error(refusal ?? 'the target connection string is not set: refusing to guess a target.');
    return 1;
  }

  const files = migrationFiles();
  const refusals = preDialFindings({
    url,
    expectedRef,
    files,
    override,
    targetChecks: targetFindings,
    read: readMigration,
    dir: MIGRATIONS_DIR,
  });
  if (exitCode(refusals) !== 0) {
    console.log(render([...refusals, ok('rehearsal', 'not run: the target or the migrations were refused above.')]));
    return exitCode(refusals);
  }

  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  let findings: Finding[];
  try {
    await client.connect();
  } catch (e) {
    console.log(render([...refusals, fail('connect', normaliseError(e).message ?? 'could not connect')]));
    return 1;
  }
  try {
    findings = [...refusals, ...(await rehearsal(client, files, readMigration))];
  } catch (e) {
    findings = [...refusals, fail('rehearsal', normaliseError(e).message ?? 'the rehearsal threw')];
  } finally {
    await client.end().catch(() => {});
  }

  console.log(render(findings));
  return exitCode(findings);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
