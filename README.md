![migration-rehearsal: four migrations applied to an empty container and to a database with real rows. Three pass on the empty one and fail on real rows, with 23502, 23505 and 23514.](.github/social-preview/preview.png)

# migration-rehearsal

[![CI](https://github.com/damson/migration-rehearsal/actions/workflows/ci.yml/badge.svg)](https://github.com/damson/migration-rehearsal/actions/workflows/ci.yml)
[![licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![node >=22.12](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen)](#running-it-yourself)
[![Postgres](https://img.shields.io/badge/postgres-any%20version-blue)](#faq)

**Most CI tests migrations on an empty database. Most migrations fail because of
the rows already there.**

This repository fixes that with a *rehearsal*: a real run on a real database,
with nothing kept. On each pull request that changes a migration, it:

1. applies the migrations the target has not run yet to a staging database with
   real rows,
2. inside a transaction that is always rolled back,
3. proves the rollback happened,
4. and blocks the pull request if the real rows break a migration.

Nothing is committed. Most of the code here exists to prove that. It needs no new
infrastructure: a staging database you already have, and about a minute of CI.

**[Read the article](docs/rehearsing-migrations-against-real-rows.md)** for the
full reasoning. It starts with a plain-language primer.

## Contents

- [The problem](#the-problem)
- [How it works](#how-it-works)
- [Adopt it in five steps](#adopt-it-in-five-steps)
- [Is this safe?](#is-this-safe)
- [Files](#files)
- [Adapting it](#adapting-it)
- [Running it yourself](#running-it-yourself)
- [FAQ](#faq)
- [What has been tested](#what-has-been-tested)
- [Contributing](#contributing)
- [Licence](#licence)

## The problem

Four migrations, each run twice: once on an empty Postgres container, as most CI
does, and once on a database with real rows.

| Migration | Empty container | Database with rows |
|---|---|---|
| Add a nullable column | passes | passes |
| Add `NOT NULL` with no default | **passes** | fails, `23502` |
| Create a unique index over duplicates | **passes** | fails, `23505` |
| Add a `CHECK` that existing rows violate | **passes** | fails, `23514` |

Three of the four fail only when there is data. An empty table breaks no rule,
because it holds nothing.

So the green tick is misleading. The pull request merges, and the migration fails
later, on the merged code.

## How it works

```sql
begin;
savepoint migration_rehearsal_root;
  -- every migration this branch has that the target has not applied yet
rollback to savepoint migration_rehearsal_root;
rollback;
```

In Postgres, schema changes such as `CREATE TABLE` and `ALTER TABLE` can run
inside a transaction, and a rollback undoes them. So a migration can run in full
against real rows, then be undone without being saved.

The savepoint is a marker inside the transaction. If a migration sneaks in a
`COMMIT`, the marker disappears, the rollback to it fails, and the run raises an
alarm.

## Adopt it in five steps

1. **Pick a target**: a staging or preview database with realistic rows. Never
   production.
2. **Copy `reference/rehearsal.ts` and `reference/run-rehearsal.ts`** into your
   repository, for example into `tools/migration-rehearsal/`. Your repository
   needs `pg` and `tsx` as dependencies.
3. **Copy `reference/rehearse-migrations.yml`** into `.github/workflows/` and
   replace the values in angle brackets. See [Adapting it](#adapting-it).
4. **Store the database credential** as a secret on a GitHub deployment
   environment, and the name of the one database it may touch as a variable.
   The article explains why an environment rather than a repository secret.
5. **Copy `reference/rehearsal-selftest.yml` and watch it pass.** It shows the
   check failing when it should. For a filled-in example, see
   `.github/workflows/selftest.yml`.

Do not make the rehearsal a required check on its own. It runs only on pull
requests that change a migration, and it passes, with a warning, whenever it has
no credential: on a fork pull request, or before the secret is set up. A required
check that passes without running is worse than none.

## Is this safe?

The rehearsal runs your pull request's SQL on a live database. Four guards make
that safe, in this order:

1. **Wrong target: refused**, before connecting. The run goes ahead only against
   the database you named as the expected one, so name a non-production one.
   An unrecognised connection string is refused.
2. **`commit` or `rollback` in a migration: refused**, before connecting. Either
   would end the transaction and keep the changes. This is a text scan, and it
   cannot catch everything: a bare `end;` also commits, and looks like the
   `end` that closes a code block.
3. **Savepoint check.** Whatever guard 2 misses, a `COMMIT` destroys the
   savepoint, so the run fails loudly. By then that write has happened, which is
   why guard 2 comes first.
4. **Before-and-after count.** The tool counts the objects in the `public`
   schema before and after, and compares them.

Guards 3 and 4 check different things on purpose. Guard 3 asks the transaction
whether it stayed intact. Guard 4 asks the database what is actually there.

While it runs, the migrations hold their locks on the target, so avoid a
database other people are using heavily at the same time.

The article covers each guard in detail, including what each one cannot catch.

## Files

| File | What it is |
|---|---|
| `docs/rehearsing-migrations-against-real-rows.md` | The article, with a primer for newcomers. |
| `reference/rehearse-migrations.yml` | The pull request check, with angle-bracket values to replace. |
| `reference/rehearsal-selftest.yml` | A self-test against a throwaway Postgres, proving the check can fail. |
| `reference/rehearsal.ts` | Every decision the rehearsal makes. |
| `reference/run-rehearsal.ts` | The wiring: environment, files, Postgres client, output. |
| `reference/rehearsal.test.ts` | Unit tests over `rehearsal.ts`, using a scripted stand-in for the database. |
| `tools/check-placeholders.mjs` | Checks that the workflows and this README agree. Runs in CI. |
| `tools/readability.mjs` | Measures how readable the article is. Runs in CI. |
| `.github/workflows/selftest.yml` | The self-test, filled in and running in this repository. |
| `examples/migrations/` | Two small migrations for the self-test to use. |

`rehearsal.ts` and `run-rehearsal.ts` are separate so that tests can import the
logic without starting the whole job.

## Adapting it

Every value you must change is a placeholder written in angle brackets. A copy
you forgot to finish fails loudly instead of touching the wrong database.

| Placeholder | What to put there |
|---|---|
| `<MIGRATIONS_DIR>` | Where your migration files live, for example `supabase/migrations`. |
| `<REHEARSAL_DIR>` | Where you copied `rehearsal.ts` and `run-rehearsal.ts`. |
| `<REHEARSAL_ENVIRONMENT>` | The GitHub deployment environment holding the credential. |
| `<REHEARSAL_DB_URL_SECRET>` | The name of the secret holding the database connection string. |
| `<EXPECTED_PROJECT_REF>` | The name of the variable naming the one database the rehearsal may touch. |
| `<NODE_VERSION>` | The Node version for the runner, for example `22`. |
| `<SECRETS_DOC>` | Where your setup notes live. It is shown when the credential is missing. |
| `<PRELUDE_SQL>` | Self-test only. SQL to create the roles and schemas your hosting provider normally supplies. Delete the step if your migrations only touch `public`. |

The reference is written for the Supabase CLI. Three parts of `rehearsal.ts`
depend on that, and each is marked at the top of the file:

- **`LEDGER_QUERY`** reads which migrations are already applied, from Supabase's
  `supabase_migrations.schema_migrations`. For another tool, point it at that
  tool's table, such as Flyway's `flyway_schema_history` or Liquibase's
  `databasechangelog`.
- **`versionOf`** reads a version number from a filename. It reads Supabase's
  `<digits>_name.sql`, so a tool with another scheme, such as Flyway's
  `V1__name.sql`, needs it rewritten. If it can read no version from any file,
  the run refuses rather than report nothing to do.
- **`projectRefFrom`** reads the Supabase project reference from a connection
  string. It must return null for any string it does not recognise, so an
  unknown database is never treated as a match.

The self-test creates Supabase's ledger table to seed it, so it needs the same
change.

## Running it yourself

You need Node 22.12 or newer. Node 23 and 25 are not supported by the test runner.

```sh
git clone https://github.com/damson/migration-rehearsal.git
cd migration-rehearsal
npm install
npm run verify   # type check, tests, placeholder and readability checks
```

To run the rehearsal against a database by hand:

```sh
REHEARSAL_TARGET_DB_URL=... \
REHEARSAL_EXPECTED_PROJECT_REF=... \
REHEARSAL_MIGRATIONS_DIR=path/to/migrations \
  npm run rehearse
```

It commits nothing. Guards 3 and 4 exist to prove that, and the self-test checks
it by asking the database.

## FAQ

**Do I need Supabase?**
No, but the reference is written for it. The rest is plain Postgres, and
[Adapting it](#adapting-it) lists the three parts to change for another tool.

**Does this touch production?**
Only if you name production as the expected database, so do not. The target is
checked before connecting, and anything else is refused.

**What if my staging database has no realistic data?**
Then it catches nothing, and still reports green. The value comes entirely from
the rows. A staging database restored from a masked production sample is the
usual fix.

**What about pull requests from forks?**
GitHub does not give secrets to fork pull requests, so the rehearsal cannot run
there. The job passes with a warning and a "did not run" summary. Using
`pull_request_target` to give it the secret would run a stranger's SQL against
your database, which is worse than the gap.

**Will it slow my pipeline down?**
By about a minute, and only on pull requests that change a migration.

**What if a statement cannot run inside a transaction?**
`CREATE INDEX CONCURRENTLY` is the usual case. It cannot be rehearsed, so the run
reports a warning and stays green. Check that migration by hand.

**What if my migration tool wraps each file in its own transaction?**
That works. The rehearsal behaves the same way, and stops at the first failure.

## What has been tested

- **The table in [The problem](#the-problem)** comes from running those four
  migrations on an empty container and on a live database, in the project this
  code came from.
- **`rehearsal.ts`** has unit tests in CI, using a scripted stand-in for the
  database.
- **The full rehearsal runs against a real Postgres 17** in this repository's CI,
  on every pull request and every push to `main` and `develop`, through
  `.github/workflows/selftest.yml`.

The latest self-test run. "Database" marks a result read from Postgres itself,
not from the tool's own report:

| Case | Result |
|---|---|
| Nothing new to apply | nothing applied, exit 0 |
| A clean new migration | applied, rolled back, `public` unchanged at 5 objects, and the new table confirmed gone (database) |
| Some filenames carry no version | the versioned ones rehearsed, the others named in a warning |
| `NOT NULL` over existing rows | `column "rehearsal_nn" of relation "rehearsal_target" contains null values [23502]`, reported as a data problem |
| A migration containing `commit` | refused before connecting |
| A migration containing `end;` | savepoint destroyed (`25P01`), and the escaped table confirmed present, so the alarm was real (database) |
| `--allow-loopback-target` pointing at a remote host | refused, naming the host |
| Local target without that flag | refused, so the default is safe |
| No filename carries a version | refused, not reported as up to date |

A stand-in database cannot tell whether a constraint would reject a real row.
That is why the two rows marked "database" carry the argument.

## Contributing

Contributions are welcome, especially from people who adopted this and hit
something the article does not cover. If a guard is weaker than it claims, please
report it as [SECURITY.md](SECURITY.md) describes.

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

[MIT](LICENSE), for the article and the code. Copyright 2026 Damien D.

No attribution is required to use the pattern. If you write about it, a link back
is appreciated.
