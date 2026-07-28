import { describe, expect, it } from 'vitest';

import { COUNTRIES, countryByCode, flagFor } from '../countries';

/**
 * The bundled country table.
 *
 * This replaced an API call to a route the hub never served. Signup caught the
 * 404 and fell back to a list of ONE country, so the selector offered South
 * Africa and nothing else to everyone — and country_code is not decoration:
 * the hub validates it (two characters, upper-cased) and stores it on the
 * account.
 *
 * The failure was silent in the worst way: the request 404s, the catch fires,
 * a valid-looking selector renders, and nobody outside one country can answer
 * the question correctly. So the shape of the data is worth pinning.
 */

describe('the bundled country list', () => {
  it('is a real list, not a stub', () => {
    // The old fallback had one entry. Anything near that means the table was
    // gutted, and a selector with three countries in it is the same bug in a
    // smaller costume.
    expect(COUNTRIES.length).toBeGreaterThan(200);
  });

  it('has no duplicate codes', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const c of COUNTRIES) {
      if (seen.has(c.code)) dupes.push(`${c.code}: ${seen.get(c.code)} / ${c.name}`);
      seen.set(c.code, c.name);
    }
    expect(dupes, `duplicate country codes:\n${dupes.join('\n')}`).toEqual([]);
  });

  it('every entry is a valid ISO 3166-1 alpha-2 code with a name', () => {
    const bad = COUNTRIES.filter((c) => !/^[A-Z]{2}$/.test(c.code) || c.name.trim().length < 2);
    expect(
      bad.map((c) => `${c.code}=${c.name}`),
      'the hub validates country_code as exactly two characters and upper-cases it, ' +
        'so an entry that is not two letters produces a 400 the user cannot act on',
    ).toEqual([]);
  });

  it('derives a flag from the code rather than carrying one that can disagree', () => {
    expect(flagFor('ZA')).toBe('🇿🇦');
    expect(flagFor('za')).toBe('🇿🇦');
    expect(flagFor('GB')).toBe('🇬🇧');
    // Not two ASCII letters: an empty string, so the selector reads as plain
    // rather than showing a broken glyph pair.
    expect(flagFor('')).toBe('');
    expect(flagFor('Z')).toBe('');
    expect(flagFor('ZAF')).toBe('');
    expect(flagFor('1A')).toBe('');
  });

  it('gives every entry a flag, since every entry is a valid code', () => {
    expect(COUNTRIES.filter((c) => c.flag === '')).toEqual([]);
  });

  it('is sorted by name so a reader can find a country', () => {
    const names = COUNTRIES.map((c) => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('contains the codes the product actually leans on', () => {
    // ZA was the entire fallback list, so it must survive; the others are a
    // spot check that the table is broad rather than regional.
    for (const code of ['ZA', 'US', 'GB', 'NG', 'KE', 'IN', 'BR', 'DE']) {
      expect(countryByCode(code), `${code} is missing from the table`).toBeDefined();
    }
  });

  it('looks up case-insensitively and returns undefined for an unknown code', () => {
    expect(countryByCode('za')?.name).toBe('South Africa');
    expect(countryByCode('ZZ')).toBeUndefined();
  });
});
