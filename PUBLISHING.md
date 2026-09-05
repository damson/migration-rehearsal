# Before this goes public

The repository is private. Nothing here is deployed and nothing publishes itself.

Settled already: the licence is MIT and covers the article and the code alike,
the docs are written for strangers, and CI runs on every push.

## The thing that used to block this is done

`reference/probe-selftest.yml` now runs here, with its placeholders substituted,
against a Postgres 17 service container, on every push and pull request. Every
guard has been watched refusing for the stated reason, including the two
assertions that come from `pg_class` rather than from the probe's own report.

The article's argument is that a check nobody has watched refuse is decoration.
That sentence no longer describes this repository.

## Settled since

**The name is `migration-rehearsal`.** It names what the technique gives you
rather than the mechanism that performs it, which stays a probe in the code and
in the article. The README says so in its opening, because a reader meeting both
words deserves to be told they are not two things.

**The reference implementation ships with the article.** It is written, tested
and exercised against a real Postgres here, so the maintenance surface is already
being paid for: one dependency and a suite that already runs. The argument
against reimplementation is the same one the article makes about the guards,
which are the part a reader is most likely to get subtly wrong.

That leaves distribution, which is not a blocker. The article can also appear as
a post linking back to these files, and nothing about shipping the repository
forecloses it.

## Still open

Everything that has to happen before the visibility flip is tracked as issues on
this repository. None of it can be done from inside a private repository.

## Identities

Git commits use `damson@users.noreply.github.com`, set locally in this
repository. `devddagnet@gmail.com` is the contact address in the security policy
and the code of conduct.
