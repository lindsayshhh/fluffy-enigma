# Overhead

A tiny widget that tells you what airplane is flying above your current location, using live ADS-B data from the [OpenSky Network](https://opensky-network.org/).

## How it works

- The browser widget asks for your location (or you can type in coordinates manually).
- A small Node server queries OpenSky's public `states/all` API for aircraft within a radius of your position, computes the closest one, and returns it.
- The widget displays the nearest plane's callsign, origin country, heading, altitude, speed, and distance, refreshing every 15 seconds.

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

`GET /api/overhead?lat=<lat>&lon=<lon>&radius=<km>`

Returns the nearest airborne aircraft to the given coordinates within `radius` km (default 60, max 250), plus the 5 nearest for reference:

```json
{
  "queried": { "lat": 40.64, "lon": -73.78, "radiusKm": 60 },
  "count": 12,
  "nearest": { "icao24": "a1b2c3", "callsign": "DAL1892", "originCountry": "United States", "distanceKm": 3.2, ... },
  "nearby": [ ... ],
  "fetchedAt": "2026-09-06T18:20:00.000Z"
}
```

## Notes

- OpenSky's anonymous API is rate-limited; the server caches responses per-location for 8 seconds to stay within it.
- If your environment blocks outbound requests to `opensky-network.org`, the widget will show a fetch error — this is a network/firewall restriction, not a bug in the app.
