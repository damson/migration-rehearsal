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

if (problems.length > 0) {
  console.error('Placeholder check FAILED:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(
  `Placeholder check ok: ${WORKFLOWS.length} workflows parse, ` +
    `${used.size} placeholders, all documented (${list(used)}).`,
);
