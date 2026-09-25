# Etsy Trending

A small website that shows what's trending on Etsy right now, overall or for any search.

## How it works

Etsy has no public "trending" endpoint, so the server works it out from the [Etsy Open API v3](https://developers.etsy.com/documentation/):

1. It fetches the 200 active listings Etsy ranks highest for the search (or for all of Etsy).
2. It ranks them by **favorites per day** since each item was first listed. This is the "Hottest" sort. It counts favorites against age plus two days, so a brand-new listing with one favorite doesn't jump to the top.
3. It loads photos and shop names for the top 48, and pulls **hot tags** from those listings.

Results are cached for 10 minutes per search to stay inside Etsy's rate limits. The page can also sort by total favorites or by newest, and you can click a hot tag to search it.

No dependencies and no build step. It's plain Node.js and vanilla HTML/CSS/JS.

## Run it

1. Create an app at https://www.etsy.com/developers/your-apps to get a **keystring** and **shared secret**.
2. Start the server:

```bash
cd etsy-trending
ETSY_API_KEY=your_keystring ETSY_SHARED_SECRET=your_shared_secret npm start
```

Then open http://localhost:3000. Without a key the page loads but shows setup instructions.

| Variable | Purpose |
| --- | --- |
| `ETSY_API_KEY` | Your Etsy app keystring (required) |
| `ETSY_SHARED_SECRET` | Your Etsy app shared secret, sent as `keystring:secret` in the `x-api-key` header |
| `PORT` | Port to listen on (default 3000) |
| `ETSY_API_BASE` | Override the API base URL, e.g. to point at a mock for testing |

## API

`GET /api/trending?q=<search>` returns `{ query, poolSize, tags, items, fetchedAt }`. Each item has `title`, `url`, `image`, `shop`, `price`, `favorites`, `ageDays` and `favoritesPerDay`.
