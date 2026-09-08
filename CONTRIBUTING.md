# Contributing

Thanks for being here. This repository is mostly an argument with some code
attached, so the most valuable contributions are often not code at all.

**Especially welcome:**

- You adopted this and hit something the article does not cover.
- A guard is weaker than it claims, or a failure mode is not handled. That is
  worth an issue on its own, and it is the kind of report this repository exists
  to invite.
- A sentence that did not make sense on first read. The article is meant to work
  for someone meeting the problem for the first time, and it cannot be tested for
  that by the person who wrote it.
- Your migration tool substitutes differently from what the README claims.
- A measurement from your own environment, agreeing or disagreeing with the table
  at the top.

## Getting set up

Node 20 or newer, and nothing else. No database is needed for the test suite.

```sh
git clone https://github.com/damson/migration-rehearsal.git
cd migration-rehearsal
npm install
npm run verify   # typecheck, tests, and the placeholder check. What CI runs.
```

## Branching

Two long-lived branches, and neither is ever committed to directly.

- **`develop`** is the default branch and where everything integrates. Cut your
  branch from it, and open your pull request against it.
- **`main`** carries releases. It moves only through a release pull request from
  `develop`.

```sh
git switch develop
git pull
git switch -c my-change
```

Two rules follow from that, and both have cost real projects real time:

- **Ordinary pull requests into `develop` are squashed.** One commit per logical
  change keeps the history readable.
- **A release pull request, `develop` into `main`, is merged with a merge
  commit.** Never squashed, never rebased. A squash is not the commits it
  squashed, so squashing a release makes every commit in it look permanently
  unmerged, and the next release then conflicts with its own history.

## What lives where

- `docs/rehearsing-migrations-against-real-rows.md` is the article. It is the
  primary artefact.
- `reference/rehearsal.ts` holds every decision, and is fully testable without a
  database.
- `reference/run-rehearsal.ts` holds the plumbing: environment, filesystem, the
  Postgres client. It calls `main()` at import time, which is exactly why the
  decisions are not in it.
- `reference/*.yml` are the two reference workflows, full of placeholders.
- `tools/check-placeholders.mjs` keeps those workflows and the README in step.

If you add a placeholder to a workflow, document it in the README table. CI will
tell you if you forget, and it will tell you if you document one that nothing
uses.

## Two rules that shape the code

**The rollback is the safety argument.** Any change that weakens a guard needs to
say, in the pull request, what replaces it. Adding a guard is easy to accept.
Removing one needs an argument.

**A check that cannot fail is not a check.** If you add a guard, add its
must-fail case to `rehearsal-selftest.yml`, and if you can, watch it go red before
you make it pass. The article says this about the pattern, and it applies to the
repository too.

## Style

There is no linter to argue with. Match the file you are editing.

Comments explain **why**, not what. Much of the value in `rehearsal.ts` is in the
comments recording why something is deliberately absent, and those are worth
preserving even when the code around them changes.

Prose here, including commit messages, avoids em-dashes. Colons, commas and full
stops do the same work.

## Commits and pull requests

- One logical change per commit.
- Write the subject as what the change achieves, not how.
- No AI attribution or generated-with markers, please.
- Say how you checked it. For an article change, "read it end to end" is a real
  answer.

## Security

Please do not open a public issue for a security problem. See
[SECURITY.md](SECURITY.md), which matters more than usual here: this pattern
involves pointing automation at a live database.

## Code of Conduct

Everyone taking part is asked to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Be kind, assume good faith, and give
people room to be new at something.
