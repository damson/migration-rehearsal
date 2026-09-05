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

## Still open

1. **The name.** `migration-probe-pattern` is a working name.
2. **Where the article lands.** A public repository is what this is built for,
   and the article would also work as a post with the reference files linked from
   it, or as a chapter in an engineering handbook. Those are not exclusive.
3. **Whether the reference implementation ships alongside it.** The article is
   complete without it. Shipping it makes the workflows usable, and adds a
   maintenance surface.

Everything that has to happen before the visibility flip is tracked as issues on
this repository.

## Identities

Git commits use `damson@users.noreply.github.com`, set locally in this
repository. `devddagnet@gmail.com` is the contact address in the security policy
and the code of conduct.
