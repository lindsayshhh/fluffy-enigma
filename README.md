# Overhead

A tiny widget that tells you what airplane is flying above your current location, using live ADS-B data from [adsb.fi](https://adsb.fi/) (falling back to [adsb.lol](https://adsb.lol/) if that's unreachable).

## How it works

- The browser widget asks for your location (or you can type in coordinates manually).
- A small Node server queries a free, keyless ADS-B aggregator for aircraft within a radius of your position, computes the closest one, and returns it.
- The widget displays the nearest plane's callsign, aircraft description, operator, route, altitude, speed, distance and the compass direction to look in, refreshing every 15 seconds.

All units are imperial: miles, mph, feet.

No API keys, no build step, and no dependencies — it's plain Node.js (`http`, built-in `fetch`) and vanilla HTML/CSS/JS.

## Run it

```bash
npm start
```

Then open http://localhost:3000 and allow location access when prompted.

Set `PORT` to run on a different port:

```bash
PORT=8080 npm start
```

## API

`GET /api/overhead?lat=<lat>&lon=<lon>&radius=<miles>`

Returns the nearest airborne aircraft to the given coordinates within `radius` miles (default 40, max 155), plus the 5 nearest for reference:

```json
{
  "queried": { "lat": 40.64, "lon": -73.78, "radiusMiles": 40 },
  "provider": "adsb.fi",
  "count": 12,
  "nearest": {
    "icao24": "a1b2c3", "callsign": "DAL1892",
    "description": "BOEING 737-900", "operator": "DELTA AIR LINES",
    "registration": "N123DL", "aircraftType": "B739", "year": "2015",
    "distanceMiles": 2.0, "bearingDeg": 286.5, "altitudeFt": 4800,
    "speedMph": 254.7, "heading": 216.9, "verticalRateFtMin": -640,
    "squawk": "1200", "emergency": null
  },
  "nearby": [ ... ],
  "fetchedAt": "2026-09-06T18:20:00.000Z"
}
```

## Notes

- Tries adsb.fi first, then adsb.lol — both free community ADS-B feeds, no signup. The server caches responses per-location for 8 seconds to be a good citizen.
- **These feeds want to know who's calling.** adsb.lol rejects requests with a generic User-Agent, so every outbound request identifies itself as `Overhead/1.0 (+<contact>)`. That contact defaults to this repo's URL; set `CONTACT_URL` to point somewhere that reaches you if you're running your own deployment.
- **airplanes.live is not in the chain.** It returns 403 to unregistered callers and asks you to email contact@airplanes.live describing your project. If they grant access, add it back to `PROVIDERS` in `server.js`.
- **Routes come from a second lookup.** ADS-B carries no origin/destination — a transponder broadcasts position and callsign, not a route — so the callsign is resolved against [adsbdb](https://www.adsbdb.com/) (free, keyless). Aircraft flying no scheduled route, which is most general aviation, simply have none; the card omits the row rather than showing a blank. `ROUTE_API_URL` overrides the endpoint, and `GET /api/route?callsign=XXX&debug=1` shows the raw upstream body.
- **Route data is scheduled, not observed, so it gets sanity-checked.** A callsign→route database can hold a stale pairing, since callsigns are reused for different city pairs on different days. Guards: one-stop routes render all their stops (`LAX → ORD → BOS`) rather than collapsing to the endpoints, and a route whose endpoints don't square with where the aircraft actually is gets flagged `suspect` and hidden. A differing echoed callsign is recorded but *not* grounds to discard — a regional flies as `EDV5412` while the seat was sold as `DL5412`, so the database legitimately answers under another name. Pass `lat`/`lon` to `/api/route` to apply the position check there too. `status` distinguishes `ok`, `unknown` (genuinely no route), `suspect`, `unavailable`, and `unparsed` — the last meaning the provider answered but the response couldn't be read, which is a parsing bug here rather than an absent route.
- `GET /api/overhead?...&debug=1` probes every provider and reports each one's status, top-level JSON keys and a body preview — the fastest way to tell a blocked request from a changed response shape.
- This project originally used the OpenSky Network API, but its anonymous access has become unreliable (tight rate limits, push toward registered OAuth clients), so it was swapped out.
- If your environment blocks outbound requests to these hosts, the widget will show a fetch error — this is a network/firewall restriction, not a bug in the app.
