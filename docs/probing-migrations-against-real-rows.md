# Probing migrations against real rows

Most projects that run migrations in CI check them against an empty database.
A throwaway Postgres container starts, every migration is applied to it in
order, the job goes green, and the pull request is declared safe to merge.

That job is worth having. It is also blind to most of the ways a migration
actually fails.

The failures that reach production are not syntax errors. They are the ones that
depend on what is already in the table: a `NOT NULL` added to a column that has
nulls in it, a unique index created over rows that are not unique, a `CHECK` that
existing rows violate. An empty database satisfies every one of those
constraints trivially, because there is nothing there to violate them. So the
gate passes, the pull request merges, and the migration fails on the way into a
database that has rows.

## The measurement

Four migrations, each applied twice: once to an empty Postgres container, once
to a live environment holding real rows, inside a transaction that was rolled
back afterwards.

| Migration | Empty container | Live target |
|---|---|---|
| Add a nullable column | succeeds | succeeds |
| Add `NOT NULL` with no default | succeeds | **fails, 23502** `not_null_violation` |
| Create a unique index over duplicates | succeeds | **fails, 23505** `unique_violation` |
| Add a `CHECK` that real rows violate | succeeds | **fails, 23514** `check_violation` |

Three of the four failure classes are invisible to any offline gate, and no
amount of care in writing the offline gate changes that. The information is not
in the container. It is in the rows.

The consequence is worse than a missing check. The offline job is green, so it
reads as coverage. The failure then surfaces on the merge commit, after the pull
request is closed and the person who wrote it has moved on, which is the most
expensive moment to discover it.

## The idea

Apply the pull request's own migrations to a real database, inside a transaction
that is rolled back before the connection closes.

```
begin;
savepoint probe_root;
  <each migration the target has not applied yet>
rollback to savepoint probe_root;
rollback;
```

Postgres runs DDL transactionally, which is the whole reason this works. A
`CREATE TABLE`, an `ALTER TABLE`, an index build: all of them can be undone by a
rollback, so a migration can be fully applied and fully un-applied without ever
being committed. The constraint checks run against the real rows, which is the
part that cannot be faked, and then the whole thing evaporates.

The target is a staging or preview database, never production. It needs real
rows, not the same rows.

## The rollback is the entire safety argument

Everything else in this pattern exists to protect one property: that nothing the
probe applies survives it. Four guards, applied in this order.

### Guard 1: refuse a target that is not the expected one, before dialling

The probe applies arbitrary SQL to whatever it is pointed at. That is its
function, so the only meaningful protection is refusing to point it anywhere
unexpected.

The run requires an expected database identifier, compares it against the one
read from the connection string, and refuses on any mismatch. It also refuses
when it cannot read an identifier at all. An unrecognised connection string is
not a pass.

The refusal has to happen before the connection is opened. By the time a log
line names the database that was reached, it has been reached.

There is one way past it: an explicit `--allow-loopback-target` flag, accepted
only when the host is loopback. It exists because a guard nobody has watched
refuse is decoration, and without it the self-test below cannot reach the code
under test at all, since a throwaway container has no project identifier to
match. On a non-loopback host the flag does not quietly stop working: it refuses
the run outright. An override that is silently ignored is how a command copied
out of a CI log reaches a real database with its only target guard switched off.

### Guard 2: refuse migrations that manage their own transaction, before dialling

A `COMMIT` inside a migration ends the probe's transaction, and everything after
it is written for real. So migration files are scanned before anything is
dialled, and a file containing `commit` or `rollback` is refused.

The text scan is deliberately literal: comments are stripped, so a header
explaining that a migration does not commit is not itself a refusal, but string
literals are not stripped. A migration is free to reword prose that trips this.
Over-refusing costs a rewrite. Under-refusing costs a write to a live database
that nothing rolls back.

**Two words that look like they belong on that list are not on it, and both
absences are load-bearing.**

`BEGIN` and `START TRANSACTION` are not banned. The obvious first draft bans
them, on the reasoning that a migration should not manage its own transaction at
all. That reasoning is wrong twice. Wrong in fact: inside an already-open
transaction, both raise `WARNING: there is already a transaction in progress` and
do nothing, so neither can let a write escape. Wrong in practice: the standard
idempotence idiom is `do $$ begin ... end $$;`, so the ban refuses ordinary,
correct migrations. In the project this pattern comes from, the over-broad list
refused six of the repository's own migrations, and it was the self-test running
against the real tree that caught it, after a unit test had already asserted that
the over-refusal was deliberate.

`END` is not banned for a different reason, and that reason is why the next
guard exists. A bare `end;` does commit. But `end if`, `end loop` and `end $$`
close plpgsql blocks, and no text pattern separates them from the one that
commits. The text guard cannot see every spelling of the escape.

### Guard 3: prove the rollback happened, with a savepoint

Open a savepoint immediately after `BEGIN`, and roll back to it before rolling
back the transaction.

A `COMMIT` destroys the savepoint. So if anything committed mid-probe, the
`ROLLBACK TO SAVEPOINT` statement fails, and that failure is the alarm. The
escape is reported rather than assumed impossible.

This is not a belt on top of braces. It is the guard that covers exactly what the
reader of guard 2 can talk themselves out of, and the case it catches is the one
guard 2 provably cannot see: a bare `end;`.

Two details matter in the implementation. The savepoint rollback works on an
aborted transaction, which is what savepoints are for, so a migration that failed
still reaches it. And the final `ROLLBACK` belongs in a `finally` block, so that a
throw anywhere above, including from the savepoint statement itself, cannot leave
a transaction open holding DDL locks on a live database.

### Guard 4: measure the target's shape either side

Count the objects in the `public` schema before the transaction opens and after
it closes, and compare.

```sql
select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace;
```

A count rather than a row check on a named table: it needs no knowledge of the
schema, and it moves for exactly the thing a migration does. This is the guard
that still speaks if a future Postgres version turns guard 3's failure into a
warning, or if the escape happened in a way the savepoint did not notice. Guard 3
asks the transaction whether it stayed intact. Guard 4 asks the database what is
actually there.

## Reporting: which gate owns this failure

A probe that just says "the migration failed" sends people to fix the wrong
thing. The useful output names the class of failure, because the class decides
what to do next.

SQLSTATE codes are enough to classify:

- **data-shape** (`23502`, `23503`, `23505`, `23514`, `22001`, `22003`, `22P02`,
  `22007`): the migration is valid SQL and applies to an empty database, but the
  target holds rows it cannot accommodate. This is the set the probe exists for.
  The fix is almost always to split it: add the column nullable, backfill in a
  script, tighten in a follow-up migration.
- **offline-visible** (`42601`, `42P01`, `42703`, `42P07`, `42710`, `42883`,
  `3F000`): the offline container applies every migration to an empty database,
  so it sees all of these already. Failing here while that job is green means the
  two disagree about the schema. That is drift worth naming, not a migration to
  fix blindly.
- **probe-limit** (`42501`, `25001`, `0A000`, `55P03`, `57014`): the probe
  reaching its own limit, not a defect in the migration. `CREATE INDEX
  CONCURRENTLY` cannot run inside a transaction, so it cannot be probed by one.
  **These warn rather than fail.** Blocking a pull request because the probe
  cannot express the statement would make the gate the thing to route around,
  which is how a required check stops being read.
- **unknown**: print the driver's message and classify nothing. A confident
  guess at an unrecognised code is worse than no guess.

Two more reporting rules earn their place:

**An empty run must not read as a pass.** "No migration in this branch is
missing from the target's ledger" is the ordinary outcome for a pull request that
touches no migration, and it has to be stated as its own line. A report built by
taking the worst of an empty list of findings is green, and a green gate that
never ran is the most misleading output a check can produce.

**A directory with no migration files in it is a failure, not a clean bill of
health.** Every per-file loop is vacuous over an empty list, so without an
explicit assertion that files were read, a misconfigured path reports success.

## Fork safety: `pull_request`, never `pull_request_target`

This is the security decision that shapes everything else, so it is worth stating
plainly.

The job runs on `pull_request`. GitHub withholds secrets from `pull_request` runs
that originate in a fork. That means a fork's pull request cannot run this check,
which looks like a gap.

The apparent fix is `pull_request_target`, which runs in the base repository's
context and does have access to secrets. Applied here, it would hand a live
database credential to a job whose entire purpose is to execute SQL that came out
of the pull request. A stranger opens a fork pull request containing a migration
file, and that file runs against a real database.

That is not a smaller problem than the one it solves. It is a much larger one.
`pull_request_target` is safe only for jobs that never execute code from the pull
request, and this job executes nothing else.

So the gap stays open, and it is closed by being loud instead. When the
credential is absent, for a fork or because setup is incomplete, the job writes a
warning annotation and a job-summary block saying in as many words that the
migrations were never applied to real rows, and then exits zero. And the check is
not marked required until the credential exists, because a required check that
passes without running is worse than no check at all.

One further rule follows from the same reasoning: no pull request title, body,
branch name or commit message is interpolated into any `run:` step. Those fields
are attacker-controlled, and shell interpolation of them is a well-known
injection path. The migration SQL is read from disk by the runner and handed to
the driver as a parameterless query, never through a shell.

## Environment-scoped secrets: what they buy and what they do not

Put the credential in a GitHub deployment environment and declare that
environment on the job.

Be honest about what this does not do. An environment can carry a
deployment-branch policy, and it is tempting to think that policy gates the
probe. It does not: a `pull_request` run's ref is `refs/pull/N/merge`, which no
branch policy matches.

What it does buy is real, and it is blast radius. An environment secret is
readable only by a job that declares that environment. Every other workflow in
the repository, including every scheduled job and every job someone adds later,
cannot read this credential. A repository secret is readable by all of them.

The credential itself should be a role scoped to what the probe needs, on a
non-production database, and the runner should never print a connection string, a
password or a key. Printing the host and the database identifier is fine: those
are not the secret.

## Operational details that are not optional

**Concurrency, cancel in progress, keyed per pull request.** The probe holds DDL
locks on live tables for as long as its transaction is open. Two probes running
at once block each other, and anything else using that database waits behind
them. A second push should supersede the first rather than queue behind it.

**Short timeouts, set before anything else runs.** A statement timeout and a
lock timeout, in the range of a minute and five seconds respectively. A migration
that cannot get its lock in five seconds is one for a maintenance window, not one
to hold a shared environment open for.

**A job-level timeout.** A hanging job is a diagnosis problem, not a waiting
problem. Without `timeout-minutes` a stall shows as a check pending for hours
instead of a readable failure.

**Stop at the first migration failure.** Continuing would apply later migrations
to a state missing this one and produce a cascade of failures that say nothing
about the change under review.

**Apply in version order, not directory order.** A directory listing is not
guaranteed to be sorted, and applying two dozen migrations out of order against a
live database produces failures that have nothing to do with the pull request.

**Say when the target is ahead of the branch.** A target holding versions the
branch does not have is ordinary: the branch was cut before something else
merged. It matters only because those versions explain why a file was not probed,
so it is worth one warning line rather than leaving it to be inferred.

## Proving the gate can fail

A gate that has never been watched refuse is a gate nobody should trust, and this
one has four guards whose failure modes are all invisible in normal operation.
The probe's self-test runs against a throwaway Postgres, where breaking things
costs nothing, and every check comes in a pair.

The must-pass half:

- a current ledger produces a pass that says nothing was checked;
- a clean pending migration applies, rolls back, and the report says so.

The must-fail half:

- a `NOT NULL` over a table with rows is refused, **and the refusal carries
  23502**. Refused for some other reason proves nothing;
- a migration containing `commit` is refused before anything is dialled;
- a migration containing a bare `end;` trips the savepoint alarm, which is the
  case the text guard provably cannot catch;
- the loopback override is refused against a non-loopback host;
- a loopback target with no override is refused, so the default is fail-closed.

Two of these assertions come from the database rather than from the tool, and
they are the ones that carry the argument:

```bash
# after the clean migration: the table it created must be GONE
left=$(psql -tAX -c "select count(*) from pg_class where relname = 'probe_ok'")
[ "$left" = "0" ] || exit 1

# after the escape: the table that committed must still be THERE
survived=$(psql -tAX -c "select count(*) from pg_class where relname = 'probe_escape'")
[ "$survived" = "1" ] || exit 1
```

The first is the only evidence that the probe does not write to its target.
Everything else in the log is the probe describing itself. The second is what
stops an alarm that fires on every run from passing this job: without it, a
hard-wired failure would satisfy the must-fail half perfectly.

One shell detail, learned the expensive way. In a step that redirects output to a
file under `set -e`, a non-zero exit aborts the step before the log is printed,
so the one artefact that would explain the failure is thrown away. Wrap the call
in `set +e`, capture the exit code, `cat` the log, and only then decide the
verdict. This applies to the must-pass steps as much as the must-fail ones.

## What this does not replace

The offline container job stays. It is faster, it runs on every pull request
including forks, and it owns the failure classes an empty database can see. The
two jobs answer different questions, and the classification above depends on both
of them existing.

The probe does not test that a migration is correct, only that it can apply. A
backfill that applies cleanly and writes the wrong values passes this gate.

And it does not remove the need for care around the statements it cannot express.
Anything that cannot run inside a transaction cannot be probed by one, and the
honest output there is a warning that says so rather than a green tick.

## Cost

One workflow file, one runner, a database that already exists, and roughly a
minute of CI per pull request that touches a migration. The failure classes it
catches would otherwise be caught by production.
