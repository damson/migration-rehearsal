/**
 * The formulas are pinned separately from the syllable estimate, on purpose.
 *
 * Syllable counting in English cannot be exact without a dictionary, so the
 * estimate will always be a little wrong. If the formula arithmetic were only
 * tested through it, a genuine error in a coefficient would be indistinguishable
 * from the estimate being off, and the natural response to a failing test would
 * be to adjust the counter. So the formulas are given counts directly.
 */
import { describe, expect, it } from 'vitest';
import {
  analyse,
  countSyllables,
  findings,
  fleschKincaidGrade,
  fleschReadingEase,
  gunningFog,
  proseOf,
  sentencesOf,
  undefinedPrimerTerms,
} from './readability.mjs';

describe('the formulas', () => {
  // 100 words, 10 sentences, 150 syllables: 10 words and 1.5 syllables per word.
  const counts = { words: 100, sentences: 10, syllables: 150, complexWords: 20 };

  it('computes Flesch reading ease from the standard coefficients', () => {
    // 206.835 - 1.015(10) - 84.6(1.5)
    expect(fleschReadingEase(counts)).toBeCloseTo(69.785, 3);
  });

  it('computes Flesch-Kincaid grade from the standard coefficients', () => {
    // 0.39(10) + 11.8(1.5) - 15.59
    expect(fleschKincaidGrade(counts)).toBeCloseTo(6.01, 3);
  });

  it('computes Gunning fog from the standard coefficients', () => {
    // 0.4[10 + 100(20/100)]
    expect(gunningFog(counts)).toBeCloseTo(12, 3);
  });

  it('moves the right way when sentences get longer', () => {
    const longer = { ...counts, sentences: 5 };
    expect(fleschReadingEase(longer)).toBeLessThan(fleschReadingEase(counts));
    expect(fleschKincaidGrade(longer)).toBeGreaterThan(fleschKincaidGrade(counts));
  });
});

describe('countSyllables', () => {
  it.each([
    ['the', 1],
    ['rhythm', 1],
    ['make', 1],
    ['table', 2],
    ['subtle', 2],
    ['migration', 3],
    ['transaction', 3],
  ])('counts %s as %i', (word, n) => {
    expect(countSyllables(word)).toBe(n);
  });

  it('never returns zero, whatever it is given', () => {
    for (const w of ['rhythms', 'x', 'nth', '']) expect(countSyllables(w)).toBeGreaterThanOrEqual(0);
    expect(countSyllables('nth')).toBe(1);
  });

  it('is an estimate, and this is where it is known to be wrong', () => {
    // "savepoint" is save-point, two syllables. The heuristic sees three vowel
    // groups and says three. Recorded rather than hidden: a compound word split
    // across a silent `e` is the case this approach cannot get right, and the
    // formulas absorb a small bias like this across thousands of words.
    expect(countSyllables('savepoint')).toBe(3);
  });
});

describe('proseOf', () => {
  it('drops fenced code, which has no sentences and would skew every ratio', () => {
    const md = ['Real prose here.', '', '```sql', 'select 1 from a_very_long_table_name;', '```', '', 'More prose.'].join('\n');
    expect(proseOf(md)).not.toContain('select');
    expect(proseOf(md)).toContain('Real prose here.');
  });

  it('drops headings and table rows', () => {
    const md = ['## A heading', '', '| a | b |', '| - | - |', '', 'Prose.'].join('\n');
    const out = proseOf(md);
    expect(out).not.toContain('A heading');
    expect(out).not.toContain('| a |');
  });

  it('keeps link text and drops the target', () => {
    const out = proseOf('See [the article](https://example.com/very/long/path) for more.');
    expect(out).toContain('the article');
    expect(out).not.toContain('example.com');
  });
});

describe('sentencesOf', () => {
  it('treats each list item as its own unit', () => {
    // The regression this pins: joined bullets produced a 57-word
    // "sentence" that no reader ever meets, and the tool named it as the
    // hardest sentence in the article.
    const md = ['Lead in:', '', '- first item here', '- second item here', '- third item here'].join('\n');
    expect(sentencesOf(md)).toHaveLength(4);
  });

  it('splits on terminal punctuation', () => {
    expect(sentencesOf('One thing. Two things! Three things?')).toHaveLength(3);
  });

  it('does not split a decimal or an initial', () => {
    expect(sentencesOf('It took 1.5 seconds to run.')).toHaveLength(1);
  });
});

describe('undefinedPrimerTerms', () => {
  const withPrimer = (primerBody, lead = 'An opening line.') =>
    ['# Rehearsing migrations against real rows', '', lead, '', '## If some of these words are new', '', primerBody, '', '## Next', '', 'Body.'].join('\n');

  it('is quiet when the primer covers every term', () => {
    const md = withPrimer('A migration, staging, a transaction, a savepoint, SQLSTATE, the ledger.');
    expect(undefinedPrimerTerms(md)).toEqual([]);
  });

  it('names a term the primer never mentions', () => {
    const md = withPrimer('A migration, staging, a transaction, a savepoint, the ledger.');
    expect(undefinedPrimerTerms(md).map((f) => f.term)).toContain('SQLSTATE');
  });

  it('flags a term sprung on the reader before the primer', () => {
    const md = withPrimer(
      'A migration, staging, a transaction, a savepoint, SQLSTATE, the ledger.',
      'We check the SQLSTATE first.',
    );
    const found = undefinedPrimerTerms(md).find((f) => f.term === 'SQLSTATE');
    expect(found?.why).toMatch(/before the primer/);
  });

  it('exempts the subject named in the title, which cannot be deferred', () => {
    const md = withPrimer(
      'A migration, staging, a transaction, a savepoint, SQLSTATE, the ledger.',
      'This is about migrations in CI.',
    );
    expect(undefinedPrimerTerms(md)).toEqual([]);
  });

  it('says so when the primer section is missing entirely', () => {
    expect(undefinedPrimerTerms('# Title\n\nNo primer at all.')[0].why).toMatch(/not found/);
  });
});

describe('findings', () => {
  const clean = analyse(
    ['# Rehearsing migrations against real rows', '', '## If some of these words are new', '', 'A migration, staging, a transaction, a savepoint, SQLSTATE, the ledger.', '', '## Body', '', 'Short lines work well. Each one is easy. The reader keeps going.'].join('\n'),
  );

  it('finds nothing in prose that is within every threshold', () => {
    expect(findings(clean)).toEqual([]);
  });

  it('refuses a grade above the threshold', () => {
    expect(findings({ ...clean, grade: 99 })[0]).toMatch(/grade 99.0 is above 11/);
  });

  it('refuses a mean sentence length above the threshold', () => {
    expect(findings({ ...clean, meanSentenceWords: 40 })[0]).toMatch(/mean sentence 40.0 words/);
  });

  it('refuses one sentence that is too long on its own', () => {
    const r = { ...clean, longest: [{ words: 90, text: 'x' }] };
    expect(findings(r)[0]).toMatch(/longest sentence is 90 words/);
  });

  it('refuses too many long sentences even when each is under the cap', () => {
    expect(findings({ ...clean, over: () => 40 })[0]).toMatch(/40 sentences over 40 words/);
  });
});
