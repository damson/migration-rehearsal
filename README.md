# migration-rehearsal

[![CI](https://github.com/damson/migration-rehearsal/actions/workflows/ci.yml/badge.svg)](https://github.com/damson/migration-rehearsal/actions/workflows/ci.yml)
[![licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](#running-it-yourself)
[![Postgres](https://img.shields.io/badge/postgres-any%20version-blue)](#faq)

**Your CI checks migrations against an empty database. Most migrations fail
because of the rows that are already there.**

This repository is a write-up of a fix, plus everything needed to adopt it: apply
a pull request's own migrations to a real, non-production database inside a
transaction that gets rolled back, prove the rollback happened, and block the
pull request when real rows cannot accommodate the change.

Nothing is written. That is the whole trick, and most of the work here goes into
proving it.

Two words appear here and they are not competing. The repository is named for
what the technique gives you: a rehearsal, on the real stage, with nothing kept
afterwards. The thing that performs one is a **probe**, and that is the word the
code and the article use throughout: `reference/probe.ts`, `npm run probe`,
`probe-migrations.yml`. The production codebase this was extracted from calls it
that too.

**[Read the article](docs/probing-migrations-against-real-rows.md)** for the full
reasoning. It is self-contained, and it opens with a plain-language primer if any
of this is new.

---

## Contents

- [The problem, in one table](#the-problem-in-one-table)
- [What you get from this repository](#what-you-get-from-this-repository)
- [How it works, in sixty seconds](#how-it-works-in-sixty-seconds)
- [Adopt it in five steps](#adopt-it-in-five-steps)
- [Is this safe?](#is-this-safe)
- [What is in the box](#what-is-in-the-box)
- [Adapting it](#adapting-it)
- [Running it yourself](#running-it-yourself)
- [FAQ](#faq)
- [Status, honestly](#status-honestly)
- [Contributing](#contributing)
- [Licence](#licence)

## The problem, in one table

Four migrations, each applied twice. Once to a fresh empty Postgres container,
the way most CI pipelines do it. Once to a live database that holds real rows,
inside a transaction that was rolled back afterwards.

| Migration | Empty container | Database with rows |
|---|---|---|
| Add a nullable column | passes | passes |
| Add `NOT NULL` with no default | **passes** | fails, `23502` |
| Create a unique index over duplicates | **passes** | fails, `23505` |
| Add a `CHECK` that existing rows violate | **passes** | fails, `23514` |

Three of the four fail only where there is data. An empty table satisfies every
constraint trivially, because there is nothing in it to violate them.

The result is worse than having no check. The green tick reads as coverage, so
the pull request merges, and the failure surfaces on the merge commit after the
author has moved on. That is the most expensive possible moment to find out.

## What you get from this repository

**A gate that catches the three invisible failure classes**, before merge, on the
pull request that caused them, with a message naming which class it is and what
to do about it.

**A safety argument you can actually check.** Four independent guards, in the
order they apply, each one written down with the reasoning for why it exists and
what it cannot cover. Two of them are runtime proofs rather than promises.

**A self-test that watches the gate refuse.** Every guard has a matching
must-fail case running against a throwaway Postgres, because a check nobody has
seen fail is decoration.

**No new infrastructure.** It uses a staging or preview database you already
have, and costs roughly a minute of CI on pull requests that touch a migration.
Nothing else in the pipeline changes.

**A fork-safe design, explained.** Including why the obvious fix for the fork gap
is much worse than the gap.

## How it works, in sixty seconds

```sql
begin;
savepoint probe_root;
  -- every migration this branch has that the target has not applied yet
rollback to savepoint probe_root;
rollback;
```

Postgres runs DDL inside transactions. A `CREATE TABLE`, an `ALTER TABLE`, an
index build: all of them can be undone by a rollback. So a migration can be fully
applied and fully un-applied without ever being committed.

The constraint checks run against the real rows, which is the part that cannot be
faked. Then the whole thing evaporates.

The savepoint is the clever bit. A `COMMIT` anywhere in the migration destroys
it, so `ROLLBACK TO SAVEPOINT` fails and the escape becomes a loud alarm instead
of a silent write.

## Adopt it in five steps

1. **Pick a target.** A staging or preview database with realistic rows. Never
   production, and the tooling refuses production by design.
2. **Copy `reference/probe.ts` and `reference/run-probe.ts`** into your
   repository, somewhere like `tools/migration-probe/`.
3. **Copy `reference/probe-migrations.yml`** into `.github/workflows/` and
   replace the placeholders. The table in [Adapting it](#adapting-it) says what
   each one is.
4. **Add the credential** as a secret on a GitHub deployment environment, and
   name that environment in the workflow. The article explains why an environment
   rather than a repository secret.
5. **Copy `reference/probe-selftest.yml` too, and watch it pass.** This is the
   step people skip, and it is the one that turns "I believe this rolls back"
   into "I have watched it roll back". Only then make the probe a required check.
   `.github/workflows/selftest.yml` here is exactly that file with the
   placeholders filled in, if you would rather copy a worked example than fill in
   a template.

## Is this safe?

It is the first question, and it deserves a straight answer: **the probe applies
your pull request's SQL to a live database.** Everything in the design exists to
make that safe, and none of it is decorative.

Four guards, in the order they apply:

1. **It refuses a target that is not the expected one, before opening a
   connection.** Production is never a valid target. An unrecognised connection
   string is a refusal, not a pass.
2. **It refuses any migration containing `commit` or `rollback`, before opening a
   connection.** Those would end the probe's transaction and let writes survive.
3. **It proves the rollback with a savepoint.** A `COMMIT` destroys the
   savepoint, so an escape that guard 2 could not see becomes an explicit alarm.
4. **It counts the database's objects before and after and compares them.** The
   rollback is measured rather than trusted.

Guards 3 and 4 are independent on purpose. Guard 3 asks the transaction whether
it stayed intact. Guard 4 asks the database what is actually there.

The article works through each of them, including the two words that look like
they belong on the banned list in guard 2 and are deliberately absent, and why
that absence is what makes guard 3 necessary.

## What is in the box

| File | What it is |
|---|---|
| `docs/probing-migrations-against-real-rows.md` | The article. Self-contained, with a primer for anyone new to migrations in CI. |
| `reference/probe-migrations.yml` | The pull request gate. Every project-specific value is a placeholder. |
| `reference/probe-selftest.yml` | The proof that the gate can fail, against a throwaway Postgres. Must-pass and must-fail halves. |
| `reference/probe.ts` | Every decision the probe makes, plus its transaction as a sequence of statements. |
| `reference/run-probe.ts` | The plumbing: environment, filesystem, the Postgres client, the printing. |
| `reference/probe.test.ts` | 30 tests over `probe.ts`, using a scripted fake driver. |
| `tools/check-placeholders.mjs` | Keeps the workflows and this README from drifting apart. Runs in CI. |
| `.github/workflows/selftest.yml` | The self-test with its placeholders substituted, running here on every push. This repository adopting its own pattern. |
| `examples/migrations/` | Two ordinary migrations, so the self-test has a real schema and a real ledger to probe. |

`probe.ts` and `run-probe.ts` are separate files because a module that calls
`main()` at import time cannot be imported by a test without running the whole
job. That split is what makes the guards testable at all.

## Adapting it

Every project-specific value in the workflows is written in angle brackets, so a
half-adapted copy fails loudly instead of quietly probing the wrong database.

| Placeholder | What to put there |
|---|---|
| `<MIGRATIONS_DIR>` | Where your migration files live, for example `supabase/migrations`. |
| `<PROBE_DIR>` | Where `probe.ts` and `run-probe.ts` land in your repository. |
| `<PROBE_ENVIRONMENT>` | The GitHub deployment environment holding the credential. |
| `<PROBE_DB_URL_SECRET>` | Name of the environment secret holding the target connection string. |
| `<EXPECTED_PROJECT_REF>` | Name of the variable identifying the one database the probe may touch. |
| `<NODE_VERSION>` | Node version for the runner, for example `20`. |
| `<SECRETS_DOC>` | Where your setup checklist lives. It is quoted in the message someone sees when the credential is missing. |
| `<PRELUDE_SQL>` | Self-test only. SQL creating whatever roles and schemas a managed provider supplies for you. Delete the step if your migrations only touch `public`. |

Three things in `probe.ts` are tied to a migration tool rather than to a project,
and they are marked as such at the top of the file:

- **`LEDGER_QUERY`**, which reads the versions already applied. The reference
  reads the Supabase CLI's `supabase_migrations.schema_migrations`. Flyway's
  `flyway_schema_history`, Liquibase's `databasechangelog` and Django's
  `django_migrations` all substitute directly.
- **`versionOf`**, which reads a version out of a filename.
- **`projectRefFrom`**, which reads a database identifier out of a connection
  string. The reference reads the two Supabase shapes. The contract that matters
  is the null: an unrecognised connection string must never be treated as a
  match.

## Running it yourself

Node 20 or newer.

```sh
git clone https://github.com/damson/migration-rehearsal.git
cd migration-rehearsal
npm install
npm run verify   # typecheck, the test suite, and the placeholder check
```

To point the probe at a database by hand:

```sh
PROBE_TARGET_DB_URL=... \
PROBE_EXPECTED_PROJECT_REF=... \
PROBE_MIGRATIONS_DIR=path/to/migrations \
  npm run probe
```

It writes nothing. That claim is exactly what guards 3 and 4 exist to prove, and
what the self-test checks by asking the database rather than the tool.

## FAQ

**Do I need Supabase?**
No. The reference implementation reads the Supabase CLI's migration ledger
because that is where it came from, and swapping it for Flyway, Liquibase, Django
or a plain table is a one-line change, marked in the file. Everything else is
plain Postgres.

**Does this touch production?**
No, and it refuses to. The target check runs before the connection is opened, and
an unrecognised target is a refusal rather than a pass. Point it at staging or a
preview database.

**What if my target has no realistic data?**
Then this catches nothing, and it will honestly report having done nothing. The
value comes entirely from the rows. A staging database restored from a
production sample is the usual answer.

**What about pull requests from forks?**
GitHub withholds secrets from fork pull requests, so the probe cannot run there.
The workflow says so loudly rather than passing quietly. The article explains why
using `pull_request_target` to close that gap would be much worse than the gap.

**Will it slow my pipeline down?**
About a minute, and only on pull requests that touch a migration, because the
workflow is path-filtered. Note that a path-filtered workflow should not be a
required status check on its own: the article and your repository settings both
have opinions about that.

**What if a statement cannot run inside a transaction?**
`CREATE INDEX CONCURRENTLY` is the usual one. It cannot be probed by a
transaction, so it is reported as a warning that says exactly that, rather than
failing the pull request. A gate that blocks on its own limitations becomes a
gate people route around.

**Does it work with a migration tool that wraps each file in its own
transaction?**
Yes. That is the common case, and the probe deliberately behaves the same way,
including stopping at the first failure.

## Status, honestly

Being precise about this matters, because the whole subject is the difference
between a check that ran and a check that looked green.

- **The measured table** at the top comes from applying those four migrations to
  both an empty container and a live target, in the project this was extracted
  from.
- **`probe.ts`** is covered by `probe.test.ts`, which runs in CI: 30 tests over
  the guards, the failure classification and the transaction sequence, against a
  scripted fake driver.
- **The whole thing runs against a real database in this repository's own CI.**
  `.github/workflows/selftest.yml` is `reference/probe-selftest.yml` with the
  placeholders substituted, pointed at `examples/migrations` and a Postgres 17
  service container. It runs on every push and every pull request.

That last one is what makes the rest worth reading. On the most recent run, in
order:

| Case | What Postgres actually said |
|---|---|
| Ledger current | nothing applied, nothing checked, exit 0 |
| Clean pending migration | applied, rolled back, `public` unchanged at 5 objects, and `probe_ok` verified absent from `pg_class` afterwards |
| `NOT NULL` over rows | `column "probe_nn" of relation "probe_target" contains null values [23502]`, classified DATA-SHAPE |
| Migration containing `commit` | refused before anything was dialled |
| Migration containing bare `end;` | savepoint destroyed, `25P01`, and `probe_escape` verified still present, so the alarm was a real one |
| Override against a non-loopback host | refused, naming the host |
| Loopback target, no override | refused, so the default is fail-closed |

A fake driver can tell you that `rollback` is issued when a migration throws. It
cannot tell you that a column name is real or that a constraint would reject a
row. The two rows above that come from `pg_class` rather than from the probe's
own report are the ones carrying the argument: the first says the probe does not
write to its target, and the second stops an alarm that fires on every run from
passing as a working guard.

## Contributing

Contributions are welcome, especially from anyone who has adopted this and hit
something the article does not cover. Corrections to the reasoning are the most
valuable kind: if a guard is weaker than it claims, that is worth an issue on its
own.

See [CONTRIBUTING.md](CONTRIBUTING.md), and the
[Code of Conduct](CODE_OF_CONDUCT.md) that everyone taking part is asked to
follow.

## Licence

[MIT](LICENSE), covering the article and the code alike. Copyright 2026
Damien D.

If you adopt the pattern, no attribution is required. If you write about it, a
link back is appreciated.
