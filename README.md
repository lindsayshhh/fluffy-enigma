# Michigan GOP Legislature Dashboard

A dashboard of every Republican member of the Michigan State House of Representatives and
Michigan State Senate, in one place: official contact pages, social media, and recent news
coverage of each member.

## How it works

- A small Node server serves the frontend and one API route — no build step, no framework,
  no API keys.
- Member data (name, district, chamber, official page, and any social accounts found) lives in
  [`public/data/legislators.json`](public/data/legislators.json), compiled from official
  Michigan House/Senate and caucus sources.
- The dashboard lets you filter by chamber, search by name or district, and open a member's
  detail panel.
- **Recent coverage** is fetched live when you open a member. The browser can't read Google
  News directly (CORS), so the server proxies it: `GET /api/news?name=…&chamber=…` fetches
  that member's Google News RSS search, parses the items, and returns JSON. Headlines link
  straight to the publications. Results are cached in memory for 15 minutes per member.
- The detail panel also embeds a **live** X/Twitter timeline (via `platform.twitter.com/widgets.js`)
  and a **live** Facebook Page feed (via the Facebook Page Plugin) directly from the member's
  own public accounts when available — no API keys required for either. Instagram/YouTube are
  linked out to directly, since there's no key-free way to embed a live feed for those.

### Tuning the news search

The query is built in `newsQuery()` in [`server.js`](server.js) as
`"Full Name" Michigan (representative|senator OR legislature OR Lansing)`. The Michigan and
role terms keep common names (there are several David Martins in the news) from pulling in
unrelated people. Loosen it for more results, tighten it for more precision.

Set `NEWS_FEED_BASE` to point at a different RSS search endpoint or a local fixture:

```bash
NEWS_FEED_BASE=http://localhost:4100/rss npm start
```

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
that link/embed.

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
