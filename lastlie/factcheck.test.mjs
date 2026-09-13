import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapClaim, mapClaims, isFalseRating, normaliseRating, buildUrl, fetchLiveEntries,
} from './providers/factcheck.js';
import { sortEntries, mergeEntries, validateEntry } from './dataset.js';

// Shaped exactly like a claims:search payload: claims[] of
// { text, claimant, claimDate, claimReview[] }, each review carrying
// { publisher: { name, site }, url, title, reviewDate, textualRating }.
const RESPONSE = {
  claims: [
    {
      text: 'There is not an empty seat in this arena.',
      claimant: 'Donald Trump',
      claimDate: '2026-09-10T00:00:00Z',
      claimReview: [
        {
          publisher: { name: 'PolitiFact', site: 'politifact.com' },
          url: 'https://www.politifact.com/factchecks/2026/sep/11/empty-seats/',
          title: 'Trump wrong about empty seats',
          reviewDate: '2026-09-11T00:00:00Z',
          textualRating: 'False',
          languageCode: 'en',
        },
      ],
    },
    {
      text: 'Prices on almost every item are rapidly going down.',
      claimant: 'Donald J. Trump',
      claimDate: '2026-09-09T00:00:00Z',
      claimReview: [
        {
          publisher: { name: 'FactCheck.org', site: 'factcheck.org' },
          url: 'https://www.factcheck.org/2026/09/prices/',
          reviewDate: '2026-09-09T00:00:00Z',
          textualRating: 'Pants on Fire!',
        },
        {
          publisher: { name: 'Snopes', site: 'snopes.com' },
          url: 'https://www.snopes.com/fact-check/prices/',
          reviewDate: '2026-09-12T00:00:00Z',
          textualRating: 'False',
        },
      ],
    },
    {
      text: 'Unemployment is at a record low.',
      claimant: 'Donald Trump',
      claimDate: '2026-09-08T00:00:00Z',
      claimReview: [
        {
          publisher: { name: 'PolitiFact', site: 'politifact.com' },
          url: 'https://www.politifact.com/factchecks/2026/sep/08/jobs/',
          reviewDate: '2026-09-08T00:00:00Z',
          textualRating: 'Half True',
        },
      ],
    },
    {
      text: 'Something a different person said.',
      claimant: 'Viral image',
      claimDate: '2026-09-07T00:00:00Z',
      claimReview: [
        {
          publisher: { name: 'Snopes', site: 'snopes.com' },
          url: 'https://www.snopes.com/fact-check/other/',
          textualRating: 'False',
        },
      ],
    },
    { text: 'A claim nobody reviewed.', claimant: 'Donald Trump', claimDate: '2026-09-06T00:00:00Z' },
    {
      text: 'Review with no link.',
      claimant: 'Donald Trump',
      claimDate: '2026-09-05T00:00:00Z',
      claimReview: [{ publisher: { name: 'PolitiFact' }, textualRating: 'False' }],
    },
    {
      text: 'Dated only by its review.',
      claimant: 'Donald Trump',
      claimReview: [
        {
          publisher: { name: 'PolitiFact', site: 'politifact.com' },
          url: 'https://www.politifact.com/factchecks/2026/sep/04/undated/',
          reviewDate: '2026-09-04T00:00:00Z',
          textualRating: 'Four Pinocchios',
        },
      ],
    },
  ],
  nextPageToken: 'abc',
};

test('rating allowlist fails closed', () => {
  for (const r of ['False', 'false', 'Pants on Fire!', 'Mostly False', 'Four Pinocchios', 'Incorrect']) {
    assert.equal(isFalseRating(r), true, `${r} should count as false`);
  }
  for (const r of ['Half True', 'True', 'Mostly True', 'Misleading', 'Unproven',
                   'No Evidence', 'Mixture', 'Satire', '', null, undefined, 'Outdated']) {
    assert.equal(isFalseRating(r), false, `${r} should NOT count as false`);
  }
});

test('rating normalisation strips punctuation and case', () => {
  assert.equal(normaliseRating('  Pants   on Fire! '), 'pants on fire');
  assert.equal(normaliseRating('"False."'), 'false');
});

test('maps a claim into an entry', () => {
  const entry = mapClaim(RESPONSE.claims[0]);
  assert.equal(entry.date, '2026-09-10');
  assert.equal(entry.rating, 'False');
  assert.equal(entry.claim, 'There is not an empty seat in this arena.');
  assert.equal(entry.source.name, 'PolitiFact');
  assert.equal(entry.source.url, 'https://www.politifact.com/factchecks/2026/sep/11/empty-seats/');
  assert.equal(entry.kind, 'live');
  // ClaimReview has no correction prose, and none is invented.
  assert.equal(entry.reality, null);
});

test('picks the newest qualifying review when several outlets checked a claim', () => {
  const entry = mapClaim(RESPONSE.claims[1]);
  assert.equal(entry.source.name, 'Snopes');
  assert.equal(entry.rating, 'False');
});

test('falls back to the review date when the claim is undated', () => {
  const entry = mapClaim(RESPONSE.claims[6]);
  assert.equal(entry.date, '2026-09-04');
});

test('drops claims by other speakers, unrated claims and unlinked reviews', () => {
  assert.equal(mapClaim(RESPONSE.claims[2]), null, 'Half True must not be published as a lie');
  assert.equal(mapClaim(RESPONSE.claims[3]), null, 'another claimant');
  assert.equal(mapClaim(RESPONSE.claims[4]), null, 'no review at all');
  assert.equal(mapClaim(RESPONSE.claims[5]), null, 'review without a url');
});

test('mapClaims reports why claims were skipped', () => {
  const { entries, skipped } = mapClaims(RESPONSE.claims);
  assert.equal(entries.length, 3);
  assert.equal(skipped.claimant, 1);
  assert.equal(skipped.noReview, 1);
  assert.equal(skipped.ratings['half true'], 1);
});

test('survives junk without throwing', () => {
  assert.equal(mapClaim(null), null);
  assert.equal(mapClaim({}), null);
  assert.equal(mapClaim({ claimant: 'Trump', claimReview: 'not-an-array' }), null);
  assert.deepEqual(mapClaims(undefined).entries, []);
  assert.equal(mapClaim({ claimant: 'Trump', claimDate: 'nonsense', claimReview: [
    { publisher: { name: 'X' }, url: 'https://x.test/a', textualRating: 'False' }] }), null);
});

test('builds a request url with the documented parameters', () => {
  const url = new URL(buildUrl({ key: 'K', query: 'Donald Trump', pageSize: 50, maxAgeDays: 365 }));
  assert.equal(url.origin + url.pathname, 'https://factchecktools.googleapis.com/v1alpha1/claims:search');
  assert.equal(url.searchParams.get('key'), 'K');
  assert.equal(url.searchParams.get('query'), 'Donald Trump');
  assert.equal(url.searchParams.get('languageCode'), 'en');
  assert.equal(url.searchParams.get('pageSize'), '50');
  assert.equal(url.searchParams.get('maxAgeDays'), '365');
});

test('no key degrades quietly instead of throwing', async () => {
  const r = await fetchLiveEntries({ key: undefined });
  assert.equal(r.ok, false);
  assert.match(r.reason, /FACTCHECK_API_KEY/);
  assert.deepEqual(r.entries, []);
});

test('a successful fetch maps through', async () => {
  const r = await fetchLiveEntries({
    key: 'K',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => RESPONSE }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 3);
  assert.equal(r.received, 7);
});

test('an API error is reported, not thrown', async () => {
  const r = await fetchLiveEntries({
    key: 'bad',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API key not valid' } }) }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /403.*API key not valid/);
  assert.deepEqual(r.entries, []);
});

test('a network failure is reported, not thrown', async () => {
  const r = await fetchLiveEntries({ key: 'K', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /ECONNREFUSED/);
});

test('a non-JSON body is reported, not thrown', async () => {
  const r = await fetchLiveEntries({
    key: 'K',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unparseable/);
});

test('entries sort newest first and keep same-day input order', () => {
  const sorted = sortEntries([
    { date: '2026-09-09', claim: 'a' }, { date: '2026-09-10', claim: 'b' },
    { date: '2026-09-09', claim: 'c' }, { date: '2026-08-01', claim: 'd' },
  ]);
  assert.deepEqual(sorted.map((e) => e.claim), ['b', 'a', 'c', 'd']);
});

test('merge prefers the curated copy of the same fact-check', () => {
  const curated = [{ date: '2026-09-10', claim: 'curated wording', kind: 'curated',
                     reality: 'prose', source: { name: 'CNN', url: 'https://cnn.test/a' } }];
  const live = [
    { date: '2026-09-10', claim: 'api wording', kind: 'live', source: { name: 'CNN', url: 'https://cnn.test/a?utm=1' } },
    { date: '2026-09-12', claim: 'newer', kind: 'live', source: { name: 'PolitiFact', url: 'https://pf.test/b' } },
  ];
  const merged = mergeEntries(curated, live);
  assert.equal(merged.length, 2, 'the duplicate fact-check collapses');
  assert.equal(merged[0].claim, 'newer');
  assert.equal(merged[1].claim, 'curated wording');
});

test('validation demands a citation, and prose only from curated entries', () => {
  const base = { date: '2026-09-10', claim: 'x', source: { name: 'CNN', url: 'https://cnn.test/a' } };
  assert.doesNotThrow(() => validateEntry({ ...base, kind: 'live', rating: 'False' }, 0));
  assert.doesNotThrow(() => validateEntry({ ...base, kind: 'curated', reality: 'y' }, 0));
  assert.throws(() => validateEntry({ ...base, kind: 'curated' }, 0), /reality/);
  assert.throws(() => validateEntry({ ...base, kind: 'live' }, 0), /rating/);
  assert.throws(() => validateEntry({ ...base, kind: 'live', rating: 'False', source: { name: 'X' } }, 0), /source/);
  assert.throws(() => validateEntry({ ...base, kind: 'live', rating: 'False', date: '10/09/2026' }, 0), /YYYY-MM-DD/);
});
