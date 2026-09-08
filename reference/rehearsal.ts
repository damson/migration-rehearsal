// The rehearsal's decisions, and its transaction as a sequence of statements.
//
// Everything here is pure or takes an injected `Queryable`, so all of it is
// reachable from a test without a database. The IO lives in run-rehearsal.ts: a
// module that calls `main()` at import time cannot be imported by a test
// without running the job.
//
// A fake client can answer the layer where the safety argument lives, and only
// that layer:
//
//   - is `rollback` issued when a migration throws, and when the savepoint
//     statement itself throws;
//   - is the transaction left unopened when there is nothing to rehearse;
//   - does a failure stop the run, so later migrations are never sent against
//     a state missing this one;
//   - does a destroyed savepoint become an alarm rather than a clean report;
//   - is the object count read on both sides, and compared.
//
// It cannot tell you that a column name is real or that a constraint would
// reject a row. Only the database answers that, which is what the self-test
// workflow is for.

/* ────────────────────────────────────────────────────────────────────────────
 * ADAPT THESE THREE to your migration tool. Everything else is generic.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every migration version the target has already applied.
 *
 * This is the Supabase CLI's ledger. For another tool, substitute its table:
 * Flyway `flyway_schema_history.version`, Liquibase `databasechangelog.id`,
 * Django `django_migrations.name`, and so on. The only requirement is that the
 * values compare equal to what `versionOf` reads off a filename.
 */
export const LEDGER_QUERY =
  'select version from supabase_migrations.schema_migrations order by version';

/** The version embedded in a migration filename, or null when there is none. */
export function versionOf(filename: string): string | null {
  const m = /^(\d+)_/.exec(filename.replace(/^.*\//, ''));
  return m ? (m[1] ?? null) : null;
}

/**
 * The project identifier a connection string names, or null when it names none.
 *
 * Two shapes are read, both Supabase: a pooler username `postgres.<ref>`, and a
 * direct host `db.<ref>.<domain>`. On another provider, replace this with
 * whatever identifies one database from another in your connection strings. The
 * contract that matters is the null: an unrecognised string must not be treated
 * as a match.
 */
export function projectRefFrom(dbUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(dbUrl);
  } catch {
    return null;
  }
  const user = decodeURIComponent(url.username);
  const pooled = /^[^.]+\.([a-z0-9]{16,})$/i.exec(user);
  if (pooled) return pooled[1] ?? null;
  const direct = /^db\.([a-z0-9]{16,})\./i.exec(url.hostname);
  return direct ? (direct[1] ?? null) : null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Findings: the report, and the exit code a workflow acts on.
 * ──────────────────────────────────────────────────────────────────────────── */

export type Level = 'ok' | 'warn' | 'fail';

export interface Finding {
  /** The check that produced it, stable enough to grep a log for. */
  check: string;
  level: Level;
  message: string;
}

export const ok = (check: string, message: string): Finding => ({ check, level: 'ok', message });
export const warn = (check: string, message: string): Finding => ({ check, level: 'warn', message });
export const fail = (check: string, message: string): Finding => ({ check, level: 'fail', message });

/**
 * The worst level present, `ok` on an empty list.
 *
 * Empty means "nothing ran", which is not the same as "everything passed", so
 * every caller that can produce an empty list says so with a finding of its own
 * rather than letting this report health.
 */
export function worst(findings: readonly Finding[]): Level {
  if (findings.some((f) => f.level === 'fail')) return 'fail';
  if (findings.some((f) => f.level === 'warn')) return 'warn';
  return 'ok';
}

/** Non-zero on any `fail`. A `warn` is information, not a broken run. */
export function exitCode(findings: readonly Finding[]): number {
  return worst(findings) === 'fail' ? 1 : 0;
}

const MARK: Record<Level, string> = { ok: 'ok  ', warn: 'WARN', fail: 'FAIL' };

/** The report, as markdown a job summary can swallow whole. */
export function render(findings: readonly Finding[]): string {
  const lines = findings.map((f) => `- \`${MARK[f.level]}\` **${f.check}**: ${f.message}`);
  return [`### Migration rehearsal: ${worst(findings).toUpperCase()}`, '', ...lines, ''].join('\n');
}

/* ────────────────────────────────────────────────────────────────────────────
 * Guard 1: the target. Refused before anything is dialled.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Accepted ONLY against a loopback host, and it skips the expected-project
 * check.
 *
 * It exists because a guard nobody has watched refuse is decoration. Without
 * it, the self-test cannot reach the code under test at all: a throwaway
 * container has no project reference, so every attempt would be refused before
 * getting there.
 *
 * On a non-loopback host the flag does not quietly stop working, it refuses the
 * run outright. Silently ignoring it would let a copied command reach a real
 * database with its only target guard switched off.
 */
export const LOOPBACK_FLAG = '--allow-loopback-target';

const LOOPBACK = [/^localhost$/i, /^127\.\d+\.\d+\.\d+$/, /^\[?::1\]?$/, /^0\.0\.0\.0$/];

export function isLoopback(hostname: string): boolean {
  return LOOPBACK.some((p) => p.test(hostname));
}

export interface Override {
  /** The flag was accepted: the expected-project check is skipped. */
  allowed: boolean;
  /** The flag was PASSED, whether or not it was accepted. */
  requested: boolean;
  findings: Finding[];
}

export function loopbackOverride(argv: readonly string[], dbUrl: string): Override {
  if (!argv.includes(LOOPBACK_FLAG)) return { allowed: false, requested: false, findings: [] };

  let hostname: string;
  try {
    hostname = new URL(dbUrl).hostname;
  } catch {
    return {
      allowed: false,
      requested: true,
      findings: [fail('target', `${LOOPBACK_FLAG} was passed but the connection string will not parse.`)],
    };
  }
  if (!isLoopback(hostname)) {
    return {
      allowed: false,
      requested: true,
      findings: [
        fail(
          'target',
          `${LOOPBACK_FLAG} is only accepted against a loopback host, and this one is ${hostname}. ` +
            'It skips the check that this is the expected database, which is the only thing standing ' +
            'between this tool and a database nobody meant to touch.',
        ),
      ],
    };
  }
  return {
    allowed: true,
    requested: true,
    findings: [
      warn(
        'target',
        `${LOOPBACK_FLAG}: the expected-project check was skipped because the host is ${hostname}. ` +
          'Valid for a throwaway container and for nothing else.',
      ),
    ],
  };
}

/**
 * Whether the connection string names the database this run is allowed to
 * touch.
 *
 * Refusing on an unreadable reference is the whole point: by the time a log
 * line says which database was reached, it has been reached.
 */
export function targetFindings(dbUrl: string, expectedRef: string): Finding[] {
  const ref = projectRefFrom(dbUrl);
  if (ref === null) {
    return [
      fail(
        'target',
        'no project reference could be read from the connection string, so the target cannot be confirmed. ' +
          'Refusing rather than applying SQL to an unidentified database.',
      ),
    ];
  }
  return ref === expectedRef
    ? [ok('target', `names ${ref}, which is the expected project.`)]
    : [
        fail(
          'target',
          `names ${ref}, but ${expectedRef} was expected. Refusing before anything is applied.`,
        ),
      ];
}

/**
 * Why the run cannot start, or null when it can.
 *
 * The expected reference is required precisely because this tool applies SQL to
 * whatever it is pointed at.
 */
export function envRefusal(
  env: { targetDbUrl?: string | undefined; expectedRef?: string | undefined },
  override: Pick<Override, 'allowed' | 'requested'>,
): string | null {
  if (!env.targetDbUrl) return 'the target connection string is not set: refusing to guess a target.';
  // `requested`, not `allowed`. A flag that was passed and REJECTED is the more
  // specific fact and it belongs in the findings, where the reason lives.
  // Reporting a missing expected reference instead sends the reader off to set
  // a variable that would not have helped.
  if (override.requested) return null;
  if (!env.expectedRef) {
    return (
      'the expected project reference is not set. It is not optional: without it there is nothing to ' +
      'refuse a production connection string with, and this tool applies SQL to whatever it is pointed ' +
      `at. Only ${LOOPBACK_FLAG}, against a loopback host, runs without it.`
    );
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Guard 2: transaction control in the SQL. Refused before anything is dialled.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Comments removed so a header discussing `commit` is not itself a refusal. */
export function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * Statements that would END the rehearsal's transaction and let a migration's
 * writes survive. Two of them, and the two that are absent matter as much.
 *
 * `begin` and `start transaction` are NOT here. Banning them is the obvious
 * first draft and it is wrong twice over. Wrong in fact: inside an open
 * transaction both raise `WARNING: there is already a transaction in progress`
 * and do nothing, so neither can let a write escape. Wrong in practice: the
 * common guard idiom is `do $$ begin ... end $$;`, so the ban refuses ordinary
 * migrations.
 *
 * `end` is absent for a different reason, and that absence is why guard 3
 * exists. Bare `end;` DOES commit, but `end if`, `end loop` and `end $$` close
 * plpgsql blocks, and no text pattern separates them. A savepoint can.
 */
export const TRANSACTION_CONTROL = ['commit', 'rollback'] as const;

/**
 * Which of them the file contains, in the order they appear.
 *
 * String literals are deliberately NOT stripped. A migration is free to reword
 * prose that trips this, and over-refusing costs a rewrite, while under-refusing
 * costs a write to a live database that nothing rolls back.
 */
export function transactionControl(sql: string): string[] {
  const body = stripComments(sql).toLowerCase();
  const hits: { at: number; word: string }[] = [];
  for (const word of TRANSACTION_CONTROL) {
    const re = new RegExp(`(?<![a-z0-9_$])${word.replace(/ /g, '\\s+')}(?![a-z0-9_$])`, 'g');
    for (const m of body.matchAll(re)) hits.push({ at: m.index ?? 0, word });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.word);
}

export function transactionControlFindings(file: string, hits: readonly string[]): Finding[] {
  if (hits.length === 0) return [];
  const unique = [...new Set(hits)].join(', ');
  return [
    fail(
      `transaction control ${file}`,
      `contains ${unique}, which would end the rehearsal's transaction and let this migration's writes ` +
        'survive against a live database. A migration never manages its own transaction here: the ' +
        'migration tool wraps each file, and so does the rehearsal. Remove the statement.',
    ),
  ];
}

/**
 * Everything about the files that can be decided without a database: that there
 * are any, and that none of them manages its own transaction.
 */
export function migrationRefusals(
  files: readonly string[],
  read: (file: string) => string,
  dir: string,
): Finding[] {
  // Asserted, not assumed. An empty directory makes the loop below vacuous, so
  // without this the rehearsal reports a clean bill of health for a run that read
  // no files at all.
  if (files.length === 0) {
    return [fail('migrations', `no .sql files in ${dir}: refusing to report a rehearsal that read nothing.`)];
  }
  return files.flatMap((file) => transactionControlFindings(file, transactionControl(read(file))));
}

/**
 * Everything decided before a connection is opened, and the order matters.
 *
 * `targetChecks` is injected rather than called directly so a test can watch
 * whether it ran. The property worth asserting is not what those checks say but
 * that the loopback override is the ONLY thing that skips them, and that it
 * skips nothing else.
 */
export function preDialFindings(input: {
  url: string;
  expectedRef?: string | undefined;
  files: readonly string[];
  override: { allowed: boolean; findings: Finding[] };
  targetChecks: (url: string, expectedRef: string) => Finding[];
  read: (file: string) => string;
  dir: string;
}): Finding[] {
  const findings: Finding[] = [...input.override.findings];
  // Under the override the target checks are the thing being skipped, so
  // running them anyway would refuse the run the override exists to permit.
  if (!input.override.allowed) {
    findings.push(...input.targetChecks(input.url, input.expectedRef ?? ''));
  }
  // The migration checks run either way. The override is about which DATABASE
  // may be reached and says nothing about what the files may contain: a rehearsal
  // against a throwaway container still must not commit.
  findings.push(...migrationRefusals(input.files, input.read, input.dir));
  return findings;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Which gate a failure belongs to. Telling these apart is the point.
 * ──────────────────────────────────────────────────────────────────────────── */

export type Blame = 'data-shape' | 'offline-visible' | 'rehearsal-limit' | 'unknown';

const BLAME: Record<string, Blame> = {
  // Needs rows. The set this rehearsal exists for, and the set no empty container
  // can reach.
  '23502': 'data-shape', // not_null_violation
  '23503': 'data-shape', // foreign_key_violation
  '23505': 'data-shape', // unique_violation
  '23514': 'data-shape', // check_violation
  '22001': 'data-shape', // string_data_right_truncation
  '22003': 'data-shape', // numeric_value_out_of_range
  '22P02': 'data-shape', // invalid_text_representation, a cast real values fail
  '22007': 'data-shape', // invalid_datetime_format
  // The offline job applies every migration against an empty database, so it
  // sees all of these already. Failing HERE and passing THERE means the two
  // disagree about the schema, which is drift worth naming rather than a
  // migration to fix blindly.
  '42601': 'offline-visible', // syntax_error
  '42P01': 'offline-visible', // undefined_table
  '42703': 'offline-visible', // undefined_column
  '42P07': 'offline-visible', // duplicate_table
  '42710': 'offline-visible', // duplicate_object
  '42883': 'offline-visible', // undefined_function
  '3F000': 'offline-visible', // invalid_schema_name
  // Not the migration's fault, and not a reason to block a pull request.
  '42501': 'rehearsal-limit', // insufficient_privilege: the rehearsal role, not the SQL
  '25001': 'rehearsal-limit', // active_sql_transaction, e.g. CREATE INDEX CONCURRENTLY
  '0A000': 'rehearsal-limit', // feature_not_supported inside a transaction block
  '55P03': 'rehearsal-limit', // lock_not_available
  '57014': 'rehearsal-limit', // query_canceled: a timeout, not a verdict
};

export function blameFor(code: string | undefined): Blame {
  return (code && BLAME[code.toUpperCase()]) || 'unknown';
}

export function blameNote(blame: Blame): string {
  switch (blame) {
    case 'data-shape':
      return (
        'this is a DATA-SHAPE failure: the migration is valid SQL and applies to an empty database, but ' +
        'the target holds rows it cannot accommodate. The offline job cannot see this and never will. ' +
        'Split it: add the column nullable, backfill in a script, tighten in a follow-up migration.'
      );
    case 'offline-visible':
      return (
        'the throwaway-Postgres job applies every migration to an empty database and should have caught ' +
        'this already. Failing here while that job is green means the two disagree about the schema: ' +
        "check whether the target's ledger matches the repository before changing the migration."
      );
    case 'rehearsal-limit':
      return (
        'this is the rehearsal reaching its own limit, not a defect in the migration. A statement that cannot ' +
        'run inside a transaction cannot be rehearsed by one, and a migration tool that wraps each file the ' +
        'same way would fail there too: verify by hand rather than trusting either result.'
      );
    default:
      return 'unrecognised SQLSTATE. The driver message above is the evidence; do not infer a cause from the exit code.';
  }
}

export interface SqlError {
  code?: string | undefined;
  message?: string | undefined;
}

/**
 * A thrown value reduced to the two fields every report reads.
 *
 * Normalised before any property access: a driver that rejects with a string,
 * or a bug that rejects with undefined, would otherwise turn a diagnostic into
 * a second TypeError thrown from the handler, and that one has no context at
 * all.
 */
export function normaliseError(e: unknown): SqlError {
  const err = (e ?? {}) as { code?: unknown; message?: unknown };
  return {
    code: typeof err.code === 'string' ? err.code : undefined,
    message: typeof err.message === 'string' ? err.message : String(e),
  };
}

export function failureFinding(file: string, err: SqlError): Finding {
  const blame = blameFor(err.code);
  const code = err.code ? ` [${err.code}]` : '';
  const message = (err.message ?? 'no message').split('\n')[0];
  return {
    check: `rehearsal ${file}`,
    // A rehearsal-limit failure is information. Blocking a pull request because the
    // rehearsal cannot express the statement would make the gate the thing to route
    // around, which is how a required check stops being read.
    level: blame === 'rehearsal-limit' ? 'warn' : 'fail',
    message: `${message}${code}. ${blameNote(blame)}`,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The transaction.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RehearsalFile {
  file: string;
  version: string;
}

/**
 * The repository's migrations the ledger has never recorded, in the order the
 * migration tool would apply them.
 *
 * Sorted by version rather than by directory order: a directory listing is not
 * guaranteed to be sorted, and applying two dozen migrations out of order
 * against a live database produces failures that have nothing to do with the
 * change under review.
 */
export function unappliedFiles(files: readonly string[], ledger: readonly string[]): RehearsalFile[] {
  const applied = new Set(ledger);
  return files
    .map((file) => ({ file, version: versionOf(file) }))
    .filter((f): f is RehearsalFile => f.version !== null && !applied.has(f.version))
    .sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * Nothing to rehearse, said as its own finding.
 *
 * An empty run is the ordinary outcome for a pull request that touches no
 * migration, and it must not read as "the rehearsal passed": `worst([])` is `ok`,
 * so an empty finding list would report a green gate that never ran.
 */
export function nothingToRehearse(applied: number): Finding {
  return ok(
    'rehearsal',
    `no migration in this branch is missing from the target's ledger (${applied} already applied). ` +
      'Nothing was applied and nothing was checked.',
  );
}

export function appliedFinding(file: string): Finding {
  return ok(`rehearsal ${file}`, 'applied inside the transaction');
}

export function rolledBackFinding(count: number): Finding {
  return ok(
    'rollback',
    `the savepoint survived all ${count} migration(s) and the transaction was rolled back: nothing was written.`,
  );
}

/**
 * The savepoint was gone, so something committed. The alarm, not a failure.
 *
 * The only outcome here that means the target database may have changed, which
 * is why it says so in its own words rather than arriving as one more red check
 * among several.
 */
export function escapedFinding(detail: string): Finding {
  return fail(
    'rollback',
    `THE REHEARSAL'S SAVEPOINT WAS DESTROYED (${detail}), which happens when a statement committed. ` +
      'Assume the target database was modified and check it by hand before merging anything: the ' +
      'rollback that makes this rehearsal safe did not happen.',
  );
}

/**
 * The shape of the target, read before and after so the rollback is measured
 * rather than trusted.
 *
 * A count of `public` objects rather than a row count on a named table: it
 * needs no knowledge of the schema, and it moves for exactly the thing a
 * migration does.
 */
export function shapeFinding(before: number, after: number): Finding {
  if (before === after) {
    return ok('shape', `public schema holds ${after} objects, unchanged across the rehearsal.`);
  }
  return fail(
    'shape',
    `public schema held ${before} objects before the rehearsal and ${after} after. The rollback did not ` +
      'restore it; inspect the target before merging.',
  );
}

/**
 * A ledger holding versions this branch does not, reported but not fatal.
 *
 * The target running ahead of a feature branch is ordinary: the branch was cut
 * before something else merged. It matters only because those versions are why
 * a file might not be rehearsed, so it is said out loud rather than left to be
 * inferred from a short list.
 */
export function strayFinding(stray: readonly string[]): Finding[] {
  if (stray.length === 0) return [];
  return [
    warn(
      'ledger ahead',
      `the target has ${stray.length} version(s) this branch does not: ${stray.join(', ')}. ` +
        'Ordinary when the branch predates a merge; rebase if the rehearsal result looks unrelated to your change.',
    ),
  ];
}

export interface QueryResult<R> {
  rows: R[];
}

/** The one method this needs from a driver, so a test can supply it. */
export interface Queryable {
  query<R = unknown>(sql: string): Promise<QueryResult<R>>;
}

export const SAVEPOINT = 'migration_rehearsal_root';

/** How many public objects the target holds: the measure the rollback must restore. */
export const SHAPE_QUERY =
  "select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace";

/**
 * The rehearsal holds DDL locks on live tables for as long as its transaction is
 * open, which on a shared environment means everything else waits behind it.
 * Both timeouts are deliberately short: a migration that cannot get its lock in
 * five seconds is one for a maintenance window, not one to hold the environment
 * open for.
 */
export const TIMEOUTS = ['set statement_timeout = 60000', 'set lock_timeout = 5000'];

async function count(client: Queryable, sql: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(sql);
  return rows[0]?.n ?? -1;
}

/**
 * Apply every migration the ledger has not recorded, then undo it.
 *
 * Never throws for a migration's sake: a failure is a finding, because the
 * caller has to print the findings gathered so far either way.
 */
export async function rehearsal(
  client: Queryable,
  files: readonly string[],
  read: (file: string) => string,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const t of TIMEOUTS) await client.query(t);

  const before = await count(client, SHAPE_QUERY);

  let ledger: string[];
  try {
    const result = await client.query<{ version?: unknown }>(LEDGER_QUERY);
    ledger = result.rows
      .map((r) => r.version)
      .filter((v): v is string | number => v !== null && v !== undefined && v !== '')
      .map(String);
  } catch (e) {
    const err = normaliseError(e);
    // 3F000 means this database has never been migrated by the tool at all,
    // which is the opposite of being behind. Comparing against an absent ledger
    // would report every migration as missing.
    const hint =
      err.code === '3F000'
        ? 'there is no migration ledger here, so nothing has ever been applied to this database by the ' +
          'migration tool. That is a database that has never been migrated, NOT a database that is behind.'
        : `could not read the migration ledger: ${err.message}`;
    return [fail('ledger', hint)];
  }

  const pending = unappliedFiles(files, ledger);
  const known = new Set(unappliedFiles(files, []).map((f) => f.version));
  findings.push(...strayFinding(ledger.filter((v) => !known.has(v))));

  if (pending.length === 0) {
    // Returning before `begin`, deliberately: a transaction opened to do
    // nothing still takes a connection and can still be left open by a crash.
    findings.push(nothingToRehearse(ledger.length));
    return findings;
  }

  await client.query('begin');
  let escaped: string | null = null;
  try {
    await client.query(`savepoint ${SAVEPOINT}`);
    for (const { file } of pending) {
      try {
        await client.query(read(file));
        findings.push(appliedFinding(file));
      } catch (e) {
        // Stop at the first failure, as the migration tool does. Continuing
        // would apply later migrations to a state missing this one and report a
        // cascade of failures that say nothing about the change under review.
        findings.push(failureFinding(file, normaliseError(e)));
        break;
      }
    }
    // Guard 3. This works on an aborted transaction, which is what a savepoint
    // is for, so a failed migration above still reaches it. What it cannot
    // survive is a COMMIT, which destroys the savepoint.
    try {
      await client.query(`rollback to savepoint ${SAVEPOINT}`);
    } catch (e) {
      const err = normaliseError(e);
      escaped = `${err.code ?? 'no code'} ${err.message ?? ''}`.trim();
    }
  } finally {
    // In a `finally` so a throw anywhere above, including from the savepoint
    // statement itself, cannot leave the transaction open holding locks. Its
    // own failure is swallowed: there is nothing useful to do about a rollback
    // that will not roll back, and letting it throw would discard every finding
    // gathered above.
    await client.query('rollback').catch(() => {});
  }

  if (escaped) findings.push(escapedFinding(escaped));

  // Guard 4, read after the transaction has closed. Independent of guard 3, and
  // the one that still speaks if `rollback to savepoint` ever warns instead of
  // raising.
  findings.push(shapeFinding(before, await count(client, SHAPE_QUERY)));
  if (!escaped) findings.push(rolledBackFinding(pending.length));

  return findings;
}
