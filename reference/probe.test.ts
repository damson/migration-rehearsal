import { describe, expect, it } from 'vitest';

import {
  LEDGER_QUERY,
  LOOPBACK_FLAG,
  SAVEPOINT,
  SHAPE_QUERY,
  blameFor,
  envRefusal,
  failureFinding,
  loopbackOverride,
  migrationRefusals,
  preDialFindings,
  probe,
  projectRefFrom,
  transactionControl,
  targetFindings,
  unappliedFiles,
  worst,
  type Finding,
  type Queryable,
} from './probe.js';

const REF = 'abcdefghijklmnopqrst';
const TARGET = `postgresql://postgres.${REF}:pw@aws-0-eu-west-2.pooler.example.com:5432/postgres`;
const LOCAL = 'postgresql://postgres:pw@localhost:5432/probe';

function sqlError(code: string, message = 'boom'): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * A driver a test can script.
 *
 * `answer` returns rows for a query, or an Error to make it throw. Anything it
 * does not recognise answers with no rows, so a test describes only the queries
 * it cares about.
 */
function db(answer: (sql: string) => unknown[] | Error | undefined = () => undefined) {
  const queries: string[] = [];
  const client: Queryable = {
    query: async <R>(sql: string) => {
      queries.push(sql);
      const result = answer(sql);
      if (result instanceof Error) throw result;
      return { rows: (result ?? []) as R[] };
    },
  };
  return { client, queries };
}

/** The default world: a target of 10 objects, a ledger holding version 1. */
function world(over: (sql: string) => unknown[] | Error | undefined = () => undefined) {
  return db((sql) => {
    const custom = over(sql);
    if (custom !== undefined) return custom;
    if (sql === SHAPE_QUERY) return [{ n: 10 }];
    if (sql === LEDGER_QUERY) return [{ version: '1' }];
    return undefined;
  });
}

const messages = (findings: readonly Finding[]) => findings.map((f) => `${f.check}: ${f.message}`).join('\n');

describe('guard 1: the target', () => {
  it('reads the project reference from both connection-string shapes', () => {
    expect(projectRefFrom(TARGET)).toBe(REF);
    expect(projectRefFrom(`postgresql://postgres:pw@db.${REF}.example.com:5432/postgres`)).toBe(REF);
  });

  it('reads no reference out of something it does not recognise', () => {
    // The null is the contract: an unrecognised string must never be treated as
    // a match for the expected project.
    expect(projectRefFrom(LOCAL)).toBeNull();
    expect(projectRefFrom('not a url')).toBeNull();
  });

  it('refuses a target it cannot identify, and one that is the wrong project', () => {
    expect(worst(targetFindings(LOCAL, REF))).toBe('fail');
    expect(worst(targetFindings(TARGET, 'zzzzzzzzzzzzzzzzzzzz'))).toBe('fail');
    expect(worst(targetFindings(TARGET, REF))).toBe('ok');
  });

  it('accepts the loopback override only against a loopback host', () => {
    expect(loopbackOverride([LOOPBACK_FLAG], LOCAL).allowed).toBe(true);
    expect(loopbackOverride([LOOPBACK_FLAG], 'postgresql://u:p@[::1]:5432/db').allowed).toBe(true);

    const refused = loopbackOverride([LOOPBACK_FLAG], TARGET);
    expect(refused.allowed).toBe(false);
    // Refused, not ignored. A flag that quietly stops working would let a
    // copied command reach a real database with its only target guard off.
    expect(refused.requested).toBe(true);
    expect(worst(refused.findings)).toBe('fail');
  });

  it('refuses the override when the connection string will not parse', () => {
    const refused = loopbackOverride([LOOPBACK_FLAG], 'not a url');
    expect(refused.allowed).toBe(false);
    expect(worst(refused.findings)).toBe('fail');
  });

  it('does nothing at all when the flag was not passed', () => {
    expect(loopbackOverride([], LOCAL)).toEqual({ allowed: false, requested: false, findings: [] });
  });

  it('requires an expected project reference, and says which flag is the way past it', () => {
    const none = { allowed: false, requested: false };
    expect(envRefusal({ targetDbUrl: undefined, expectedRef: REF }, none)).toMatch(/refusing to guess/);
    expect(envRefusal({ targetDbUrl: TARGET, expectedRef: undefined }, none)).toContain(LOOPBACK_FLAG);
    expect(envRefusal({ targetDbUrl: TARGET, expectedRef: REF }, none)).toBeNull();
  });

  it('leaves a rejected override to report itself', () => {
    // `requested`, not `allowed`. Reporting a missing expected reference here
    // would send the reader off to set a variable that would not have helped.
    expect(
      envRefusal({ targetDbUrl: TARGET, expectedRef: undefined }, { allowed: false, requested: true }),
    ).toBeNull();
  });

  it('skips the target checks under the override, and nothing else', () => {
    let ran = 0;
    const input = {
      url: LOCAL,
      files: ['1_a.sql'],
      targetChecks: () => {
        ran += 1;
        return [];
      },
      read: () => 'commit;',
      dir: 'migrations',
    };

    const guarded = preDialFindings({ ...input, override: { allowed: false, findings: [] } });
    expect(ran).toBe(1);
    const overridden = preDialFindings({ ...input, override: { allowed: true, findings: [] } });
    expect(ran).toBe(1);

    // The migration checks run either way: the override is about which DATABASE
    // may be reached, not about what the files may contain.
    expect(messages(guarded)).toMatch(/transaction control/);
    expect(messages(overridden)).toMatch(/transaction control/);
  });
});

describe('guard 2: transaction control in the SQL', () => {
  it('finds the statements that would end the transaction', () => {
    expect(transactionControl('create table t (id int);\ncommit;')).toEqual(['commit']);
    expect(transactionControl('rollback;\ncommit;')).toEqual(['rollback', 'commit']);
  });

  it('does not refuse a header that merely discusses committing', () => {
    expect(transactionControl('-- this migration does not commit\ncreate table t (id int);')).toEqual([]);
    expect(transactionControl('/* commit is handled by the tool */ select 1;')).toEqual([]);
  });

  it('leaves plpgsql block terminators alone, which is why guard 3 exists', () => {
    // `end if`, `end loop` and `end $$` close blocks, and bare `end;` commits.
    // No text pattern separates them, so none of them is banned here.
    const guarded = 'do $$ begin if true then null; end if; end $$;';
    expect(transactionControl(guarded)).toEqual([]);
    expect(transactionControl('create table t (id int);\nend;')).toEqual([]);
  });

  it('does not match a word that merely contains one', () => {
    expect(transactionControl('create table commits (id int);')).toEqual([]);
    expect(transactionControl('select rollback_at from t;')).toEqual([]);
  });

  it('refuses to report a probe that read no files at all', () => {
    // An empty directory makes every per-file loop vacuous, so without this the
    // run reports a clean bill of health for having checked nothing.
    expect(worst(migrationRefusals([], () => '', 'migrations'))).toBe('fail');
  });
});

describe('telling the failure classes apart', () => {
  it('puts the classes an empty container cannot reach in data-shape', () => {
    for (const code of ['23502', '23505', '23514', '23503']) expect(blameFor(code)).toBe('data-shape');
  });

  it('puts what an offline job already sees in offline-visible', () => {
    for (const code of ['42601', '42P01', '42703']) expect(blameFor(code)).toBe('offline-visible');
  });

  it('does not guess at a code it does not know', () => {
    expect(blameFor(undefined)).toBe('unknown');
    expect(blameFor('XX000')).toBe('unknown');
  });

  it('blocks on a data-shape failure and only warns on its own limits', () => {
    // A probe-limit failure is information. Blocking a pull request because the
    // probe cannot express the statement would make the gate the thing to route
    // around, which is how a required check stops being read.
    expect(failureFinding('1_a.sql', sqlError('23502')).level).toBe('fail');
    expect(failureFinding('1_a.sql', sqlError('25001')).level).toBe('warn');
    expect(failureFinding('1_a.sql', sqlError('23502')).message).toMatch(/DATA-SHAPE/);
  });

  it('survives a driver that rejects with something that is not an Error', () => {
    expect(failureFinding('1_a.sql', { message: undefined }).level).toBe('fail');
  });
});

describe('which files are pending', () => {
  it('applies them in version order, whatever order the directory listed them', () => {
    expect(unappliedFiles(['3_c.sql', '1_a.sql', '2_b.sql'], ['1']).map((f) => f.file)).toEqual([
      '2_b.sql',
      '3_c.sql',
    ]);
  });

  it('skips a file whose name carries no version', () => {
    expect(unappliedFiles(['notes.sql', '2_b.sql'], []).map((f) => f.file)).toEqual(['2_b.sql']);
  });
});

describe('the transaction', () => {
  const read = () => 'create table t (id int);';

  it('never opens one when there is nothing to probe', async () => {
    const { client, queries } = world();
    const findings = await probe(client, ['1_a.sql'], read);

    expect(queries).not.toContain('begin');
    // And it says so, rather than reporting a green gate that never ran.
    expect(messages(findings)).toMatch(/Nothing was applied and nothing was checked/);
  });

  it('applies what is pending, then rolls it back', async () => {
    const { client, queries } = world();
    const findings = await probe(client, ['1_a.sql', '2_b.sql'], read);

    expect(queries).toContain('begin');
    expect(queries).toContain(`savepoint ${SAVEPOINT}`);
    expect(queries).toContain(`rollback to savepoint ${SAVEPOINT}`);
    expect(queries.at(-2)).toBe('rollback');
    expect(worst(findings)).toBe('ok');
    expect(messages(findings)).toMatch(/nothing was written/);
  });

  it('stops at the first failure and still rolls back', async () => {
    const { client, queries } = world((sql) => (sql.startsWith('create table fail') ? sqlError('23502') : undefined));
    const findings = await probe(
      client,
      ['2_b.sql', '3_c.sql'],
      (f) => (f === '2_b.sql' ? 'create table fail (id int);' : 'create table later (id int);'),
    );

    // Continuing would apply later migrations to a state missing this one and
    // report a cascade that says nothing about the change under review.
    expect(queries).not.toContain('create table later (id int);');
    expect(queries).toContain('rollback');
    expect(worst(findings)).toBe('fail');
    expect(messages(findings)).toMatch(/23502/);
  });

  it('raises the alarm when the savepoint is gone, and does not call it clean', async () => {
    const { client } = world((sql) =>
      sql === `rollback to savepoint ${SAVEPOINT}` ? sqlError('3B001', 'no such savepoint') : undefined,
    );
    const findings = await probe(client, ['2_b.sql'], read);

    expect(messages(findings)).toMatch(/SAVEPOINT WAS DESTROYED/);
    expect(messages(findings)).not.toMatch(/nothing was written/);
    expect(worst(findings)).toBe('fail');
  });

  it('rolls back even when the savepoint statement itself throws', async () => {
    const { client, queries } = world((sql) =>
      sql === `savepoint ${SAVEPOINT}` ? sqlError('42601') : undefined,
    );
    // The throw is not swallowed here: the runner turns it into a `probe`
    // finding so the report still prints. What must not depend on the caller is
    // the rollback, which is in a `finally` precisely so that nothing above can
    // leave the transaction open holding locks on a live database.
    await expect(probe(client, ['2_b.sql'], read)).rejects.toThrow('boom');

    expect(queries).toContain('rollback');
  });

  it('measures the rollback rather than trusting it', async () => {
    let calls = 0;
    const { client } = world((sql) => (sql === SHAPE_QUERY ? [{ n: calls++ === 0 ? 10 : 11 }] : undefined));
    const findings = await probe(client, ['2_b.sql'], read);

    // Guard 4 is independent of guard 3: it still speaks if `rollback to
    // savepoint` ever warns instead of raising.
    expect(worst(findings)).toBe('fail');
    expect(messages(findings)).toMatch(/The rollback did not restore it/);
  });

  it('reads the ledger before anything else, and explains an absent one', async () => {
    const { client, queries } = world((sql) => (sql === LEDGER_QUERY ? sqlError('3F000') : undefined));
    const findings = await probe(client, ['2_b.sql'], read);

    expect(queries).not.toContain('begin');
    expect(messages(findings)).toMatch(/never been migrated/);
  });

  it('says out loud when the target is ahead of the branch', async () => {
    const { client } = world((sql) => (sql === LEDGER_QUERY ? [{ version: '1' }, { version: '9' }] : undefined));
    const findings = await probe(client, ['1_a.sql', '2_b.sql'], read);

    expect(messages(findings)).toMatch(/1 version\(s\) this branch does not: 9/);
    // Ordinary, so it must not block the pull request.
    expect(worst(findings)).toBe('warn');
  });

  it('sets both timeouts before it touches anything', async () => {
    const { client, queries } = world();
    await probe(client, ['1_a.sql'], read);

    expect(queries.slice(0, 2)).toEqual(['set statement_timeout = 60000', 'set lock_timeout = 5000']);
  });
});
