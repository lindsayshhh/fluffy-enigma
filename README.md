# Michigan GOP Legislature Dashboard

A dashboard of every Republican member of the Michigan State House of Representatives and
Michigan State Senate, in one place: official contact pages, social media, and a direct link
to each member's campaign finance filings on the state's own disclosure system.

## How it works

- A small static Node server serves the frontend — no build step, no framework, no API keys.
- Member data (name, district, chamber, official page, and any social accounts found) lives in
  [`public/data/legislators.json`](public/data/legislators.json), compiled from official
  Michigan House/Senate and caucus sources.
- The dashboard lets you filter by chamber, search by name or district, and open a member's
  detail panel.
- The detail panel embeds a **live** X/Twitter timeline (via `platform.twitter.com/widgets.js`)
  and a **live** Facebook Page feed (via the Facebook Page Plugin) directly from the member's
  own public accounts when available — no API keys required for either. Instagram/YouTube are
  linked out to directly, since there's no key-free way to embed a live feed for those.
- Campaign finance reports are **not** stored or restated in this app. Instead, every member
  links to Michigan's official Bureau of Elections campaign finance disclosure search, so
  what you see is always the current, authoritative filing — not a number that can go stale
  or be transcribed wrong.

## Run it

```bash
npm start
```

Then open http://localhost:3000.

Set `PORT` to run on a different port:

```bash
PORT=8080 npm start
```

## Updating the roster

Edit `public/data/legislators.json`. Each entry looks like:

```json
{
  "name": "Full Name",
  "chamber": "House",
  "district": 12,
  "officialUrl": "https://www.house.mi.gov/...",
  "caucusUrl": "https://www.gophouse.org/...",
  "twitter": "https://x.com/handle",
  "facebook": "https://facebook.com/page",
  "instagram": "https://instagram.com/handle",
  "youtube": "https://youtube.com/@channel"
}
```

Leave a field `null` if it isn't verified rather than guessing — the dashboard just omits
that link/embed. The top-level `campaignFinanceSearchUrl`, `campaignFinanceHubUrl`, and
`campaignFinanceNote` fields control the finance links shown for every member.

Michigan has now migrated its campaign finance system twice, so if the search link breaks
again, update `campaignFinanceSearchUrl` and leave `campaignFinanceHubUrl` pointing at the
Department of State's disclosure page — that hub survives migrations and links to whatever
the current tool is.

## Data

The current roster (`public/data/legislators.json`) covers all 76 Republican members of the
103rd Michigan Legislature (2025–2026 term): 58 in the House, 18 in the Senate. It was compiled
from official sources — house.mi.gov, senate.michigan.gov, gophouse.org, misenategop.com, and
Ballotpedia/Wikipedia cross-checks — plus each member's own official and social pages. Social
links were left `null` rather than guessed wherever they couldn't be independently verified, so
some members who do have accounts may still show no link; 67 of the 76 currently have at least
one verified social link.

## Notes

- Data reflects the current (2025–2026) legislative term as of when it was compiled; Michigan
  House seats turn over every 2 years, so re-verify the roster after each general election.
- If your environment blocks outbound requests to `platform.twitter.com` or
  `connect.facebook.net`, the live embeds won't render — this is a network restriction, not a
  bug; the direct link buttons still work.
