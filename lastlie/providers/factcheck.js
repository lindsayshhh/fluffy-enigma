// Live claims from Google's Fact Check Tools API, which indexes the
// schema.org ClaimReview markup that fact-checkers publish.
//
//   GET https://factchecktools.googleapis.com/v1alpha1/claims:search
//
// A claim comes back as { text, claimant, claimDate, claimReview[] }, and each
// review as { publisher: { name, site }, url, title, reviewDate, textualRating }.
// There is no claimant query parameter, so the search is a text query and the
// claimant is matched here.
//
// Note what ClaimReview does NOT carry: a prose correction. It gives a rating
// and a link, so live entries have no `reality` text — the page leads with the
// publisher's own rating instead.

const ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

// Ratings are free text and differ per publisher, so this is an allowlist and
// it fails closed: anything unrecognised is dropped rather than published as a
// "lie". Dropped ratings are reported so the list can be widened deliberately
// instead of silently swallowing claims.
const FALSE_RATINGS = new Set([
  'false',
  'mostly false',
  'pants on fire',
  'pants on fire!',
  'incorrect',
  'not true',
  'untrue',
  'fake',
  'fabricated',
  'three pinocchios',
  'four pinocchios',
]);

export function normaliseRating(rating) {
  return String(rating || '')
    .toLowerCase()
    .replace(/[""'".!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Deliberately narrow. "Misleading", "unproven", "no evidence" and the like are
// not falsehoods, and this site only records claims a fact-checker called false.
export function isFalseRating(rating) {
  return FALSE_RATINGS.has(normaliseRating(rating));
}

function isoDay(value) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
  return m ? m[1] : null;
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function matchesClaimant(claimant, needle) {
  return String(claimant || '').toLowerCase().includes(needle.toLowerCase());
}

// One API claim becomes at most one entry: the review used is the newest one,
// so a claim several outlets checked cites the most recent of them.
export function mapClaim(claim, { claimant = 'Trump' } = {}) {
  if (!claim || !matchesClaimant(claim.claimant, claimant)) return null;

  const reviews = Array.isArray(claim.claimReview) ? claim.claimReview : [];
  const usable = reviews
    .filter((r) => r && r.url && r.publisher && (r.publisher.name || r.publisher.site))
    .sort((a, b) => String(b.reviewDate || '').localeCompare(String(a.reviewDate || '')));

  const review = usable.find((r) => isFalseRating(r.textualRating));
  if (!review) return null;

  const date = isoDay(claim.claimDate) || isoDay(review.reviewDate);
  const text = String(claim.text || '').trim();
  if (!date || !text) return null;

  return {
    id: `${date}-${slug(text)}`,
    date,
    rating: String(review.textualRating).trim(),
    claim: text,
    venue: null,
    // ClaimReview has no correction prose. Left absent rather than invented.
    reality: null,
    kind: 'live',
    source: {
      name: review.publisher.name || review.publisher.site,
      title: review.title || null,
      url: review.url,
    },
  };
}

// Why a claim was skipped, so `?debug=1` can explain an unexpectedly short list.
export function mapClaims(claims, opts = {}) {
  const entries = [];
  const skipped = { claimant: 0, noReview: 0, incomplete: 0, ratings: {} };

  for (const claim of claims || []) {
    if (!matchesClaimant(claim?.claimant, opts.claimant || 'Trump')) {
      skipped.claimant += 1;
      continue;
    }

    const entry = mapClaim(claim, opts);
    if (entry) {
      entries.push(entry);
      continue;
    }

    const reviews = Array.isArray(claim?.claimReview) ? claim.claimReview : [];
    if (!reviews.length) {
      skipped.noReview += 1;
      continue;
    }
    if (!reviews.some((r) => isFalseRating(r?.textualRating))) {
      for (const r of reviews) {
        const key = normaliseRating(r?.textualRating) || '(none)';
        skipped.ratings[key] = (skipped.ratings[key] || 0) + 1;
      }
      continue;
    }
    skipped.incomplete += 1;
  }

  return { entries, skipped };
}

export function buildUrl({ key, query, pageSize, maxAgeDays, languageCode = 'en' }) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('key', key);
  url.searchParams.set('query', query);
  url.searchParams.set('languageCode', languageCode);
  url.searchParams.set('pageSize', String(pageSize));
  if (maxAgeDays) url.searchParams.set('maxAgeDays', String(maxAgeDays));
  return url.toString();
}

export async function fetchLiveEntries({
  key,
  query = 'Donald Trump',
  claimant = 'Trump',
  pageSize = 50,
  maxAgeDays = 365,
  timeoutMs = 10000,
  fetchImpl = fetch,
} = {}) {
  if (!key) {
    return { ok: false, reason: 'no FACTCHECK_API_KEY set', entries: [], skipped: null };
  }

  const url = buildUrl({ key, query, pageSize, maxAgeDays });

  let res;
  try {
    res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    return { ok: false, reason: `request failed: ${err.message || err}`, entries: [], skipped: null };
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message ? ` — ${body.error.message}` : '';
    } catch {
      /* a non-JSON error body tells us nothing extra */
    }
    return { ok: false, reason: `API returned ${res.status}${detail}`, entries: [], skipped: null };
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    return { ok: false, reason: `unparseable response: ${err.message || err}`, entries: [], skipped: null };
  }

  const { entries, skipped } = mapClaims(json?.claims, { claimant });
  return { ok: true, reason: null, entries, skipped, received: (json?.claims || []).length };
}
