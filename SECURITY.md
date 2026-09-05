# Security policy

This repository describes a pattern that points automation at a live database, so
security reports are taken seriously here even though nothing in it is deployed.

## Reporting a vulnerability

Please do not open a public issue.

Use GitHub's private vulnerability reporting on this repository: go to the
**Security** tab, then **Report a vulnerability**. It creates a private thread
visible only to the maintainers.

If that is unavailable to you, email `devddagnet@gmail.com` with the details and
a way to reach you. Expect an acknowledgement within a week.

## What is worth reporting

The interesting reports are about the **reasoning**, not only about the code.
This repository publishes a safety argument, and a flaw in the argument is a
flaw that gets copied into other people's pipelines.

Specifically:

- A way for a migration to escape the probe's transaction that the guards do not
  catch. Guard 2 is a text scan and is known to be incomplete, which is why guard
  3 exists, so the interesting case is one that gets past guard 3 as well.
- A way to make the probe reach a database other than the expected one.
- A workflow injection path in either reference workflow. Neither interpolates
  pull request titles, bodies, branch names or commit messages into a `run:`
  step, and a place where that is not true is a real finding.
- Anything that would cause a credential, connection string or password to be
  printed to a log or a job summary.
- A case where the probe reports success without having run, which is the failure
  mode the whole design is organised against.

## What is out of scope

- The reference implementation being incomplete for a migration tool it does not
  claim to support.
- Problems in Postgres, the Supabase CLI, `pg`, or GitHub Actions themselves.
  Please report those upstream.
- The fork gap. A pull request from a fork gets no credential and the check does
  not run. That is documented, deliberate, and explained in the article.
