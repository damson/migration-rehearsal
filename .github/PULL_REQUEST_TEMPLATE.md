<!--
    ┌─────────────────────────────────────────────────────────────────────┐
    │  Base this on `develop`, not `main`. `main` carries releases and    │
    │  moves only through a release pull request. CONTRIBUTING.md has the │
    │  branching, the conventions, and how to run everything locally.     │
    └─────────────────────────────────────────────────────────────────────┘

    ALWAYS PRESENT, four sections, however small the change:
        👥 In plain words · 📋 What changed · ✅ Test plan · 🔍 Review

    CONDITIONAL, two sections. Each is wrapped in its own comment block
    below. If it does not apply, DELETE the block outright, header and all.
    Never leave "N/A":
        🖼 Visual changes   (only if a person can see it)
        🛡 If this touches a guard

    Corrections to the reasoning are welcome and do not need code attached.
    Draft pull requests are welcome too: open it early and ask.
-->

## 👥 In plain words

<!--
    What is different for someone adopting this, in language a person who has
    never written a migration gate can follow. One short paragraph.

    The register to aim for:
    "Before, a migration that would break on real data still passed the check,
    because the check ran against an empty database. Now the same migration is
    tried against a database that has rows in it, and the pull request is
    blocked before anyone merges it."
-->

## 📋 What changed

<!--
    The change itself, grouped if it touches several things. Link the issue it
    closes.

    If it touches both the article and the reference files, say which one drove
    the other: the article is the argument, the files are the implementation of
    it, and they are only useful while they agree.
-->

<!--
    ═══ CONDITIONAL, DELETE THIS BLOCK IF NOTHING VISIBLE CHANGED ═══

## 🖼 Visual changes

    For the README banner or the social preview card. Both come from
    `.github/social-preview/`, and one file does both jobs, so a change to one
    is a change to the other.

    The card carries the article's failure table. If those numbers change, the
    card is part of the change, not decoration around it.

    | Before | After |
    |---|---|
    | ![before](url) | ![after](url) |
-->

## ✅ Test plan

<!--
    Say what you ran and what it said, not just that it passed.

    "Read it end to end" is a real answer for a change to the article. "The
    self-test went red for the right reason, then green" is the answer for a
    change to a guard.
-->

- [ ] `npm run verify` passes locally (typecheck, tests, placeholder check)
- [ ] If a placeholder was added or removed, the README table matches
- [ ] If the article changed, the reference files still agree with it
- [ ] The self-test still passes against a real Postgres in CI

<!--
    ═══ CONDITIONAL, DELETE THIS BLOCK IF IT TOUCHES NO GUARD ═══

## 🛡 If this touches a guard

    The four guards are the entire safety argument, and the article's own claim
    is that a check nobody has watched refuse is decoration. So this section
    asks for the refusal, not for the pass.

- [ ] The guard is not weakened, or this says what replaces it
- [ ] A must-fail case exists in `rehearsal-selftest.yml`, and **I watched it go
      red before making it pass**
- [ ] The article's description of the guard still matches what the code does
-->

## 🔍 Review

- [ ] CI is green, or this names the check that is red and why
- [ ] Review comments re-read after each push, and each one either addressed or
      answered with a reason
- [ ] The article and the reference files tell the same story after this lands
