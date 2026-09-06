<!--
Base this on `develop`, not `main`. `main` carries releases and moves only
through a release pull request. See CONTRIBUTING.md § Branching.
-->

# What this changes

<!-- One or two sentences. What is different after this lands? -->

# Why

<!-- The problem it solves, or the issue it closes. -->

# How it was checked

<!-- "npm run verify" for code. "Read it end to end" is a real answer for the article. -->

- [ ] `npm run verify` passes locally
- [ ] If a placeholder was added or removed, the README table matches
- [ ] If the article changed, the reference files still agree with it

# If this touches a guard

<!-- Delete this section if it does not. -->

- [ ] The guard is not weakened, or the pull request says what replaces it
- [ ] A must-fail case exists in `rehearsal-selftest.yml`, and I watched it go red
      before making it pass

<!--
Thank you for this. Corrections to the reasoning are welcome and do not need
code attached.
-->
