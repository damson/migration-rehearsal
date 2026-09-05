# Before this goes public

The repository is private. Nothing here is deployed and nothing publishes itself.

Settled already: the licence is MIT and covers the article and the code alike,
the docs are written for strangers, and CI runs on every push.

## The one thing that should happen first

**Run `reference/probe-selftest.yml` green, once, in a repository where the
placeholders have been substituted.**

Nothing in this repository has ever connected to a database. The reference
implementation's pure logic is tested, and its plumbing is not, because there is
no Postgres here to test it against. The article's own argument is that a check
nobody has watched refuse is decoration, and until that self-test runs, the
sentence describes the reference implementation as much as anything else.

It is tracked as an issue on this repository.

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
