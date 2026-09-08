# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
