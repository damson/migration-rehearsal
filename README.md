# migration-probe-pattern

CI usually checks migrations against an empty database. Three of the four ways a
migration actually fails need rows to be visible at all.

This repository is the write-up of a gate that closes that gap: apply a pull
request's own migrations to a live non-production database inside a transaction
that is rolled back, prove the rollback happened, and block the pull request when
real rows cannot accommodate the change.

**Start here: [Probing migrations against real rows](docs/probing-migrations-against-real-rows.md).**
The article is self-contained. The measurement, the four guards, the fork-safety
reasoning and the self-test are all in it.

## What is in `reference/`

| File | What it is |
|---|---|
| `probe-migrations.yml` | The pull request gate. Parameterised: every project-specific value is an `<ANGLE_BRACKET>` placeholder. |
| `probe-selftest.yml` | The proof that the gate can fail, against a throwaway Postgres. Must-pass and must-fail halves. |
| `probe.ts` | Every decision the probe makes, plus its transaction as a sequence of statements. Pure, or driver-injected. |
| `run-probe.ts` | The IO: environment, filesystem, the `pg` client, the printing. |
| `probe.test.ts` | 30 tests over `probe.ts`, using a scripted fake driver. |

`probe.ts` and `run-probe.ts` are separate because a module that calls `main()` at
import time cannot be imported by a test without running the job. That split is
what makes the guards testable at all.

## Adapting it

Every project-specific value in the workflows is an angle-bracket placeholder, so
a half-adapted copy fails loudly at parse time instead of quietly probing the
wrong database.

| Placeholder | What it is |
|---|---|
| `<MIGRATIONS_DIR>` | Where migration files live. |
| `<PROBE_DIR>` | Where `probe.ts` and `run-probe.ts` land in your repository. |
| `<PROBE_ENVIRONMENT>` | The GitHub deployment environment holding the credential. |
| `<PROBE_DB_URL_SECRET>` | Environment secret: the target connection string. |
| `<EXPECTED_PROJECT_REF>` | Variable naming the one database the probe may touch. |
| `<NODE_VERSION>` | Runner Node version. |
| `<SECRETS_DOC>` | Where your setup checklist lives, quoted in the "did not run" message. |
| `<PRELUDE_SQL>` | Self-test only: SQL creating whatever roles and schemas a managed provider supplies. Delete the step if your migrations only touch `public`. |

Three things in `probe.ts` are tied to a migration tool rather than to a project,
and they are marked as such at the top of the file:

- `LEDGER_QUERY`, which reads the versions the target has already applied. The
  reference reads the Supabase CLI's `supabase_migrations.schema_migrations`.
  Flyway's `flyway_schema_history`, Liquibase's `databasechangelog` and Django's
  `django_migrations` all substitute directly.
- `versionOf`, which reads a version out of a filename.
- `projectRefFrom`, which reads a database identifier out of a connection string.
  The reference reads the two Supabase shapes. The contract that matters is the
  null: an unrecognised connection string must never be treated as a match.

## Running it

```sh
npm install
npm run verify   # typecheck and the test suite
```

To point it at a database by hand:

```sh
PROBE_TARGET_DB_URL=... PROBE_EXPECTED_PROJECT_REF=... PROBE_MIGRATIONS_DIR=... \
  npm run probe
```

It writes nothing. That claim is what guards 3 and 4 exist to prove, and what the
self-test workflow checks by asking the database rather than the tool.

## What has been verified, and where

Being precise about this matters, because the whole subject is the difference
between a check that ran and a check that looked green.

- **The measured failure-class table in the article** comes from applying those
  four migrations to both an empty container and a live target, in the project
  this pattern was extracted from.
- **`probe.ts`** is covered by `probe.test.ts`, which runs here: 30 tests over the
  guards, the classification and the transaction sequence, against a scripted
  fake driver.
- **`run-probe.ts` and both workflows** have not been executed in this
  repository. They are transcriptions of code that runs in the origin project,
  parameterised. Nothing here has ever connected to a database.

A fake driver can tell you that `rollback` is issued when a migration throws. It
cannot tell you that a column name is real or that a constraint would reject a
row. The self-test workflow is what answers that, and running it is the first
thing to do after adapting the placeholders.
