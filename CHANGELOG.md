# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Nothing yet.

## [0.1.0]

First version. Not yet public.

### Added

- The article, `docs/probing-migrations-against-real-rows.md`: the measured
  failure-class table, the four guards in the order they apply, the reasoning for
  the two transaction-control keywords that are deliberately not banned, the
  SQLSTATE classification, the `pull_request` over `pull_request_target`
  argument, the environment-scoped secret argument, and the self-test.
- `reference/probe-migrations.yml`, the pull request gate, parameterised.
- `reference/probe-selftest.yml`, the must-pass and must-fail proof against a
  throwaway Postgres.
- `reference/probe.ts` and `reference/run-probe.ts`, a reference implementation
  split so the decisions are testable without a database.
- `reference/probe.test.ts`, 30 tests over the guards, the classification and the
  transaction sequence.
- `tools/check-placeholders.mjs`, which parses both reference workflows and holds
  the placeholder list and the README table to each other.

### Known gaps

- `run-probe.ts` and both workflows have never been executed in this repository.
  Nothing here has connected to a database.

[Unreleased]: https://github.com/damson/migration-probe-pattern/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/damson/migration-probe-pattern/releases/tag/v0.1.0
