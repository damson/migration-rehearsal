// Keeps the reference workflows and the README from drifting apart.
//
// Three things are checked, and each of them has gone wrong in someone's
// repository before:
//
//   1. The reference workflows are well-formed YAML. They are full of
//      placeholders, so nothing else in CI ever parses them, and a broken one
//      would be discovered by the first person trying to adopt it.
//   2. Every <PLACEHOLDER> in a workflow is documented in the README table. An
//      undocumented placeholder is a value someone has to reverse-engineer.
//   3. Every placeholder documented in the README is actually used. A stale row
//      sends people looking for something that is not there.
//   4. Every action in a reference workflow is pinned to a full commit SHA, and
//      to the same one this repository's own workflows run. Dependabot bumps the
//      pins under .github/workflows and cannot see reference/, so without this
//      the copies people adopt fall behind the ones that are tested.
//
// It also refuses to pass on a workflow with no placeholders at all, because
// that is what a half-finished substitution looks like, and because every check
// in this repository is supposed to fail when it has nothing to check.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = ['reference/rehearse-migrations.yml', 'reference/rehearsal-selftest.yml'];
const README = 'README.md';

const PLACEHOLDER = /<([A-Z][A-Z0-9_]*)>/g;

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tokens = (text) => new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]));
const list = (set) => [...set].sort().join(', ');

const problems = [];
const used = new Set();

for (const file of WORKFLOWS) {
  const source = read(file);

  try {
    const doc = parse(source);
    if (!doc || typeof doc !== 'object') {
      problems.push(`${file}: parsed, but not into a mapping. That is not a workflow.`);
      continue;
    }
    if (!doc.jobs || Object.keys(doc.jobs).length === 0) {
      problems.push(`${file}: parsed, but declares no jobs.`);
    }
  } catch (e) {
    problems.push(`${file}: is not well-formed YAML. ${e.message.split('\n')[0]}`);
    continue;
  }

  const found = tokens(source);
  if (found.size === 0) {
    problems.push(
      `${file}: contains no <PLACEHOLDER> at all. Either the substitution was ` +
        'half-finished, or this check is watching the wrong file.',
    );
  }
  for (const t of found) used.add(t);
}

const documented = tokens(read(README));

const undocumented = [...used].filter((t) => !documented.has(t));
if (undocumented.length > 0) {
  problems.push(
    `used in a workflow but missing from the README table: ${list(new Set(undocumented))}. ` +
      'Someone adopting this has to reverse-engineer what to put there.',
  );
}

const unused = [...documented].filter((t) => !used.has(t));
if (unused.length > 0) {
  problems.push(
    `documented in the README but used nowhere: ${list(new Set(unused))}. ` +
      'A stale row sends people looking for something that is not there.',
  );
}

// Every `uses:` in a workflow, read from the parsed YAML so the step's layout
// (block or flow mapping, quoted or not) cannot hide one. Job-level `uses:`
// (a reusable workflow) counts too.
function pinsIn(text) {
  const doc = parse(text);
  const pins = [];
  for (const job of Object.values(doc?.jobs ?? {})) {
    const uses = [job?.uses, ...(job?.steps ?? []).map((step) => step?.uses)];
    for (const value of uses) {
      if (typeof value !== 'string') continue;
      const at = value.lastIndexOf('@');
      pins.push(at < 0 ? { action: value, ref: '' } : { action: value.slice(0, at), ref: value.slice(at + 1) });
    }
  }
  return pins;
}

// Every pin this repository's own workflows run, per action. Two different
// pins for one action is a disagreement to fix, not a choice for whichever
// file happens to be read last.
const tested = new Map();
for (const file of fs.readdirSync(path.join(ROOT, '.github/workflows')).sort()) {
  for (const { action, ref } of pinsIn(read(path.join('.github/workflows', file)))) {
    if (!tested.has(action)) tested.set(action, new Set());
    tested.get(action).add(ref);
  }
}
for (const [action, refs] of tested) {
  if (refs.size > 1) {
    problems.push(`.github/workflows pins ${action} to ${[...refs].sort().join(' and ')}. Pick one.`);
  }
}

let pinned = 0;
for (const file of WORKFLOWS) {
  for (const { action, ref } of pinsIn(read(file))) {
    pinned++;
    const refs = tested.get(action);
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      problems.push(`${file}: ${action}@${ref} is not pinned to a full commit SHA.`);
    } else if (!refs || refs.size !== 1 || !refs.has(ref)) {
      problems.push(
        `${file}: ${action}@${ref} differs from what this repository's own workflows run ` +
          `(${refs ? [...refs].join(', ') : 'nothing'}). Copy the pin across, so what people adopt is what CI tested.`,
      );
    }
  }
}
if (pinned === 0) problems.push('found no `uses:` in the reference workflows: this check is reading the wrong files.');

if (problems.length > 0) {
  console.error('Placeholder check FAILED:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(
  `Placeholder check ok: ${WORKFLOWS.length} workflows parse, ` +
    `${used.size} placeholders, all documented (${list(used)}), ${pinned} action pins match.`,
);
