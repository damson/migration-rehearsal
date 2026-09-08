// Measures the article's prose, and refuses when it drifts out of range.
//
//   node tools/readability.mjs                       # the article, with thresholds
//   node tools/readability.mjs <file> --report-only  # numbers, no verdict
//
// WHY THIS EXISTS. The article opens with a primer written so that nothing
// later assumes prior knowledge. Whether that primer works is the one thing its
// author cannot judge, because they already know the material: re-reading your
// own explanation tells you it is correct, never that it is followable.
//
// The honest check is a reader who does not know the material. Failing that,
// this measures the properties that make prose hard in ways an author stops
// seeing: sentences that got long while being edited, paragraphs that grew, and
// the terms the primer promised to define being used before they are defined.
//
// WHAT IT IS NOT. A readability score is not comprehension. Flesch and Fog
// count syllables and sentence lengths; they cannot tell whether the savepoint
// argument lands. A document can score well and still lose its reader. So this
// is a floor and a locator, not a verdict on the writing: the useful output is
// the list of the worst individual sentences, which is where a reader gets
// stuck, and the undefined-term check, which is where a primer has failed at
// its one job.
//
// THE FORMULAS are the standard ones, so the numbers mean what they mean
// elsewhere:
//
//   Flesch Reading Ease   206.835 - 1.015 (words/sentence) - 84.6 (syllables/word)
//   Flesch-Kincaid Grade    0.39  (words/sentence) + 11.8  (syllables/word) - 15.59
//   Gunning Fog             0.4 [ (words/sentence) + 100 (complex words/words) ]
//
// Syllable counting is a heuristic, as it is in every implementation of these
// formulas: English orthography does not permit an exact one without a
// dictionary. `readability.test.mjs` pins the formula arithmetic separately from
// the counter, so a drifting estimate cannot be mistaken for a formula bug.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = 'docs/rehearsing-migrations-against-real-rows.md';

/**
 * The terms the article's own primer undertakes to explain, and therefore the
 * ones that must not appear in the body before the primer has covered them.
 *
 * This list is the primer's promise made checkable. Adding a term here without
 * covering it in the primer is what the check is for.
 */
export const PRIMER_TERMS = [
  'migration',
  'staging',
  'transaction',
  'savepoint',
  'SQLSTATE',
  'ledger',
];

/**
 * Prose only: code, tables, headings and link targets removed.
 *
 * Every one of these skews the formulas in a different direction and none of
 * them is prose. A YAML block has no sentences at all, so leaving it in inflates
 * words-per-sentence without bound; a table of SQLSTATE codes is mostly
 * polysyllabic tokens, which wrecks the syllable ratio; a URL is one enormous
 * "word".
 */
export function proseOf(markdown) {
  const lines = markdown.split('\n');
  const kept = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*#{1,6}\s/.test(line)) continue; // headings are labels, not prose
    if (/^\s*\|/.test(line)) continue; // table rows
    if (/^\s*(-{3,}|={3,})\s*$/.test(line)) continue; // rules and setext underlines
    kept.push(line);
  }

  return (
    kept
      .join('\n')
      // Link text stays, the target goes.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Inline code is one token a reader skims, not the several words it may
      // contain. Replaced rather than deleted so the sentence still reads in the
      // report, and so it counts as the single unit it is.
      .replace(/`[^`]*`/g, ' CODE ')
      .replace(/https?:\/\/\S+/g, ' ')
  );
}

/**
 * Sentences, split on terminal punctuation that is not an abbreviation or a
 * decimal.
 *
 * A list item is its own unit even when it carries no full stop. Without that,
 * a bullet list joins into one enormous pseudo-sentence and the tool reports a
 * 57-word monster that no reader ever meets: the first version of this did
 * exactly that, and the "worst sentence" it named was four bullets.
 */
export function sentencesOf(prose) {
  return prose
    .split(/\n\s*\n/)
    .flatMap((para) => para.split(/\n(?=\s*(?:[-*+]|\d+\.)\s)/))
    .flatMap((unit) =>
      unit
        .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
        .replace(/\s+/g, ' ')
        .split(/(?<![A-Z])(?<!\d)[.!?]+(?=\s|$)/),
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /[a-z]/i.test(s));
}

/** Words, hyphenated compounds counted once, bare punctuation dropped. */
export function wordsOf(text) {
  return (text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).filter((w) => /[A-Za-z]/.test(w));
}

/**
 * Syllables in an English word, estimated.
 *
 * Vowel groups, minus a silent terminal `e`, with a floor of one. The floor is
 * load-bearing rather than defensive: a word estimated at zero syllables would
 * pull the whole document's ratio down, and words like "rhythm" hit it.
 */
export function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g) ?? [];
  let n = groups.length;
  // A terminal `e` is usually silent, but not when it is the only vowel group
  // ("the"), and not after a consonant + `le` ("subtle", "table").
  if (/e$/.test(w) && n > 1 && !/[^aeiouy]le$/.test(w)) n -= 1;
  return Math.max(1, n);
}

export const fleschReadingEase = ({ words, sentences, syllables }) =>
  206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);

export const fleschKincaidGrade = ({ words, sentences, syllables }) =>
  0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;

export const gunningFog = ({ words, sentences, complexWords }) =>
  0.4 * (words / sentences + 100 * (complexWords / words));

/** Every measure this tool knows how to take, over one markdown document. */
export function analyse(markdown) {
  const prose = proseOf(markdown);
  const sentences = sentencesOf(prose);

  const measured = sentences.map((text) => {
    const ws = wordsOf(text);
    const syl = ws.reduce((n, w) => n + countSyllables(w), 0);
    return {
      text,
      words: ws.length,
      syllables: syl,
      complex: ws.filter((w) => countSyllables(w) >= 3).length,
    };
  });

  const words = measured.reduce((n, s) => n + s.words, 0);
  const syllables = measured.reduce((n, s) => n + s.syllables, 0);
  const complexWords = measured.reduce((n, s) => n + s.complex, 0);
  const totals = { words, sentences: measured.length, syllables, complexWords };

  const paragraphs = prose
    .split(/\n\s*\n/)
    .map((p) => wordsOf(p).length)
    .filter((n) => n > 0);

  return {
    totals,
    ease: fleschReadingEase(totals),
    grade: fleschKincaidGrade(totals),
    fog: gunningFog(totals),
    meanSentenceWords: words / measured.length,
    longest: [...measured].sort((a, b) => b.words - a.words),
    over: (n) => measured.filter((s) => s.words > n).length,
    paragraphs: {
      count: paragraphs.length,
      mean: paragraphs.reduce((a, b) => a + b, 0) / paragraphs.length,
      longest: Math.max(...paragraphs),
    },
    undefinedTerms: undefinedPrimerTerms(markdown),
  };
}

/**
 * Primer terms the primer fails to cover, or that the body springs on a reader
 * before the primer has covered them.
 *
 * The subject of the article is exempt from the second rule, and deliberately.
 * "Migration" appears in the title and in the first line, as it must: an article
 * cannot defer naming what it is about until after its glossary. Flagging that
 * was this check's first output and it was noise, which is how a check earns
 * being ignored. What the rule is really for is a term like SQLSTATE or
 * savepoint turning up in the opening with no help attached.
 */
export function undefinedPrimerTerms(markdown, terms = PRIMER_TERMS) {
  const lines = markdown.split('\n');
  const primerStart = lines.findIndex((l) => /^##\s+If some of these words are new/i.test(l));
  if (primerStart === -1) return [{ term: '(primer)', why: 'the primer section was not found' }];

  const primerEnd = lines.findIndex((l, i) => i > primerStart && /^##\s/.test(l));
  const before = lines.slice(0, primerStart).join('\n');
  const primer = lines.slice(primerStart, primerEnd === -1 ? undefined : primerEnd).join('\n');
  const title = (lines.find((l) => /^#\s/.test(l)) ?? '').toLowerCase();

  const out = [];
  for (const term of terms) {
    const re = new RegExp(`\\b${term}`, 'i');
    if (!re.test(primer)) {
      out.push({ term, why: 'the primer never mentions it' });
      continue;
    }
    if (title.includes(term.toLowerCase())) continue; // the subject, named in the title
    if (re.test(proseOf(before))) {
      out.push({ term, why: 'used in the opening, before the primer explains it' });
    }
  }
  return out;
}

/**
 * The thresholds, and why each number is where it is.
 *
 * These are a floor, chosen against what the article measures today so that the
 * check catches DRIFT rather than re-litigating prose that has already been
 * reviewed. A threshold set below current performance is a threshold that never
 * fires, which is the failure mode worth avoiding in a check nobody watches.
 */
export const THRESHOLDS = {
  // Measured 2026-09-08: grade 9.0, mean 17.0 words, 3 sentences over 40, the
  // longest 42. Each threshold sits just above that, so the check fires on
  // drift rather than re-litigating prose that has already been reviewed. A
  // threshold parked far above current performance never fires, which is the
  // failure mode worth avoiding in a check nobody watches.
  maxGrade: 11,
  maxMeanSentenceWords: 20,
  maxSentenceWords: 50,
  maxOver40: 6,
};

export function findings(report, t = THRESHOLDS) {
  const out = [];
  if (report.grade > t.maxGrade) {
    out.push(`Flesch-Kincaid grade ${report.grade.toFixed(1)} is above ${t.maxGrade}.`);
  }
  if (report.meanSentenceWords > t.maxMeanSentenceWords) {
    out.push(
      `mean sentence ${report.meanSentenceWords.toFixed(1)} words, above ${t.maxMeanSentenceWords}.`,
    );
  }
  const longest = report.longest[0];
  if (longest && longest.words > t.maxSentenceWords) {
    out.push(`longest sentence is ${longest.words} words, above ${t.maxSentenceWords}.`);
  }
  const over40 = report.over(40);
  if (over40 > t.maxOver40) {
    out.push(`${over40} sentences over 40 words, above ${t.maxOver40}.`);
  }
  for (const u of report.undefinedTerms) {
    out.push(`primer term "${u.term}": ${u.why}.`);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const reportOnly = args.includes('--report-only');
  const file = args.find((a) => !a.startsWith('--')) ?? DEFAULT_FILE;
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);

  if (!fs.existsSync(full)) {
    console.error(`::error::${file} does not exist.`);
    process.exit(2);
  }

  const r = analyse(fs.readFileSync(full, 'utf8'));

  console.log(`${file}`);
  console.log(
    `  ${r.totals.words} words, ${r.totals.sentences} sentences, ${r.paragraphs.count} paragraphs`,
  );
  console.log(`  Flesch reading ease   ${r.ease.toFixed(1)}`);
  console.log(`  Flesch-Kincaid grade  ${r.grade.toFixed(1)}`);
  console.log(`  Gunning fog           ${r.fog.toFixed(1)}`);
  console.log(
    `  sentences             mean ${r.meanSentenceWords.toFixed(1)} words, ` +
      `${r.over(30)} over 30, ${r.over(40)} over 40, longest ${r.longest[0]?.words}`,
  );
  console.log(
    `  paragraphs            mean ${r.paragraphs.mean.toFixed(1)} words, longest ${r.paragraphs.longest}`,
  );

  console.log('\n  the five sentences a reader is most likely to stop at:');
  for (const s of r.longest.slice(0, 5)) {
    console.log(`    [${s.words}w] ${s.text.slice(0, 150)}${s.text.length > 150 ? '...' : ''}`);
  }

  const problems = findings(r);
  if (reportOnly) {
    console.log(`\n  ${problems.length} threshold finding(s), not enforced (--report-only).`);
    return;
  }
  if (problems.length === 0) {
    console.log('\nReadability ok, within every threshold.');
    return;
  }
  console.log('');
  for (const p of problems) console.log(`::error::${p}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
