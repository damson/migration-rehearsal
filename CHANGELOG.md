# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security

- Guard 2 finds comments the way Postgres does. It read any `/*` as the start
  of a comment, including one inside a string literal, a quoted identifier, a
  dollar-quoted body or a `--` comment, and deleted everything up to the next
  `*/`. A `commit` placed between the two passed guard 2 and ran for real,
  leaving guard 3 to report a write that had already happened. The stripper is
  now a lexer that honours quoting, `E''` escapes, dollar quotes and nested
  block comments. It reads each plain string both with and without
  backslash escapes, because a migration can turn `standard_conforming_strings`
  off for its own session, and refuses if either reading finds a statement. Its
  cost is linear: a few megabytes of unterminated `/*`
  could previously hold the job until its timeout. The self-test watches the
  quoted case refuse.
- A migration that is not a regular file, such as a symlink, is refused before
  anything is read. The step that reads migrations holds the credential, and
  following a link would send any file the runner can read to the database as
  SQL. An error that escapes the runner is printed as one escaped line, and
  the report also strips characters that reorder or hide text.
- Guard 2 refuses `abort`, `end work` and `end transaction`, which are
  `rollback` and `commit` under other names, and `prepare transaction`, which detaches the rehearsal's
  transaction and leaves every later statement to commit on its own. The
  headers that said it refuses all transaction control now say what it refuses,
  and that a bare `end;` is caught by guard 3 after its write.
- A filename, a database message or a ledger version reaches the report as a
  one-line code span. A migration named with a line break could otherwise
  write a `::warning::` workflow command or a forged heading into the job log
  and the job summary, and markdown in any of the three rendered there.
- The reference gate runs the rehearsal tool, its dependencies and its lockfile
  from the base commit, and reads only the migration files from the pull
  request. A pull request that edited the runner or the lockfile could
  otherwise print the database credential from the step that holds it. The
  remaining path is documented in the workflow and the article: a pull request
  that edits a workflow, or adds one declaring the environment, gets the
  secret, and only required reviewers on the environment stop that. Both also
  say that a failure can quote a row value into a report that is public on a
  public repository.
- Every action in the reference workflows and in this repository's own is
  pinned to a full commit SHA. The reference workflows had fallen behind on
  `@v5` tags, because Dependabot does not see `reference/`, and
  `check-placeholders` now fails when their pins differ from the tested ones.

### Fixed

- A migrations directory in which no filename carries a version is refused,
  rather than reported as a ledger that is already current. `versionOf` is one
  of the three things an adopter points at their own migration tool, and one
  left on the reference's Supabase scheme skipped every Flyway or Liquibase
  filename in silence. Nothing was left pending, the run said the ledger was
  current, and the gate went green over a rehearsal that applied nothing.
  `migrationRefusals` now asserts that at least one filename parsed, which is
  the assertion it already made about an empty directory, one step later. A
  single unversioned file beside the migrations is still skipped, and is now
  named in a warning rather than dropped silently. Both halves are watched in
  `rehearsal-selftest.yml`.

## [0.2.0] - 2026-09-08

### Added

- `tools/readability.mjs`, a benchmark for the article: Flesch reading ease,
  Flesch-Kincaid grade, Gunning fog, sentence and paragraph lengths, and a
  check that the primer covers the terms it promises. It names the sentences a
  reader is most likely to stop at, which is the useful output; a score is not
  comprehension. Runs in `npm run verify` and in CI, where it is also watched
  refusing a fixture written to break it. The article measures grade 9.0, mean
  sentence 17 words.

### Changed

- `reference/rehearsal.ts` exports `RehearsalFile` and `nothingToRehearse`,
  previously `ProbeFile` and `nothingToProbe`. Rename them in an older copy.
- The repository description says rehearsing, not probing.

## [0.1.0] - 2026-09-08

First public release. The version was drafted before the repository was public
and never tagged, so the rename below ships inside it.

### Added

- `docs/rehearsing-migrations-against-real-rows.md`, the article: the measured
  failure-class table, the four guards in the order they apply, the SQLSTATE
  classification, and the cases for `pull_request` over `pull_request_target`
  and for an environment-scoped secret.
- `reference/rehearse-migrations.yml`, the pull request gate, parameterised.
- `reference/rehearsal-selftest.yml`, the must-pass and must-fail proof against
  a throwaway Postgres.
- `reference/rehearsal.ts` and `run-rehearsal.ts`, split so the decisions are
  testable without a database, with 30 tests in `rehearsal.test.ts`.
- `tools/check-placeholders.mjs`, holding the placeholder list and the README
  table to each other.
- `.github/workflows/selftest.yml` and `examples/migrations/`, the reference
  self-test running here on every push and pull request. Every guard has been
  watched refusing, for the stated reason, against a real database.

### Changed

- The repository is `migration-rehearsal`, previously `migration-probe-pattern`.
  GitHub redirects the old URL.
- The mechanism is a rehearsal, not a probe, throughout: file names, the article,
  `npm run rehearse`, and the workflow placeholders. If you copied the reference
  files earlier, rename `<REHEARSAL_DIR>`, `<REHEARSAL_ENVIRONMENT>` and
  `<REHEARSAL_DB_URL_SECRET>` in your own workflow, and nothing else.

[Unreleased]: https://github.com/damson/migration-rehearsal/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/damson/migration-rehearsal/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/damson/migration-rehearsal/releases/tag/v0.1.0
