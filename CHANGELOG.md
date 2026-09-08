# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-09-08

First public release. The version was drafted before the repository was public
and never tagged, so everything below ships under it, the rename included.

### Added

- The article, `docs/rehearsing-migrations-against-real-rows.md`: the measured
  failure-class table, the four guards in the order they apply, the reasoning for
  the two transaction-control keywords that are deliberately not banned, the
  SQLSTATE classification, the `pull_request` over `pull_request_target`
  argument, the environment-scoped secret argument, and the self-test.
- `reference/rehearse-migrations.yml`, the pull request gate, parameterised.
- `reference/rehearsal-selftest.yml`, the must-pass and must-fail proof against a
  throwaway Postgres.
- `reference/rehearsal.ts` and `reference/run-rehearsal.ts`, a reference implementation
  split so the decisions are testable without a database.
- `reference/rehearsal.test.ts`, 30 tests over the guards, the classification and the
  transaction sequence.
- `tools/check-placeholders.mjs`, which parses both reference workflows and holds
  the placeholder list and the README table to each other.

- `.github/workflows/selftest.yml` and `examples/migrations/`: the reference
  self-test with its placeholders substituted, running against a Postgres 17
  service container on every push and pull request. Every guard has been watched
  refusing, for the stated reason, against a real database.

### Changed

- The repository is `migration-rehearsal`. It was `migration-probe-pattern`, a
  working name. Nothing has been released under either, and GitHub redirects the
  old URL.
- The mechanism is a **rehearsal** throughout, where it used to be a probe. The
  reference files are `rehearsal.ts`, `run-rehearsal.ts`,
  `rehearse-migrations.yml` and `rehearsal-selftest.yml`; the article is
  `docs/rehearsing-migrations-against-real-rows.md`; the script is
  `npm run rehearse`; and the workflow placeholders are `<REHEARSAL_DIR>`,
  `<REHEARSAL_ENVIRONMENT>` and `<REHEARSAL_DB_URL_SECRET>`. Anyone who had
  already copied the reference files renames those three placeholders in their
  own workflow, and nothing else.
- The self-test's job is `rehearsal guards and rollback, on throwaway Postgres`,
  the last name still carrying the old word. It went last and on its own,
  because it is a required status check on `develop`: the rename and the branch
  protection have to move together, or every open pull request waits on a check
  name that no longer reports.

[Unreleased]: https://github.com/damson/migration-rehearsal/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/damson/migration-rehearsal/releases/tag/v0.1.0
