# Before this is published

Nothing here has been pushed anywhere. The repository is local, `package.json`
carries `"private": true`, and there is no `LICENSE` file.

Open decisions, all of them the maintainer's:

1. **Where the article lands.** A public repository is the option this is built
   for, but the article stands on its own and would work as a post with the
   reference files linked from it, or as a section of an existing engineering
   handbook.
2. **The licence.** Code and prose may want different ones: MIT or Apache-2.0 for
   the reference implementation, CC BY or similar for the article.
3. **The name.** `migration-probe-pattern` is a working name.
4. **Whether the reference implementation ships at all.** The article is complete
   without it. Shipping it makes the workflows usable, and adds a maintenance
   surface.

## Before flipping anything public

- Run the self-test workflow against a throwaway Postgres at least once, in a
  repository where the placeholders have been substituted. It is the only thing
  that proves the reference implementation works end to end, and it has never
  been run here.
- Re-read the article for anything that identifies a specific project,
  environment or account. It was written to name none.
