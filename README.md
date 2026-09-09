# Overhead

A tiny widget that tells you what airplane is flying above your current location, using live ADS-B data from [airplanes.live](https://airplanes.live/) (falling back to [adsb.lol](https://adsb.lol/) if that's unreachable).

## How it works

- The browser widget asks for your location (or you can type in coordinates manually).
- A small Node server queries a free, keyless ADS-B aggregator for aircraft within a radius of your position, computes the closest one, and returns it.
- The widget displays the nearest plane's callsign, aircraft type/registration, heading, altitude, speed, and distance, refreshing every 15 seconds.

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
  "provider": "airplanes.live",
  "count": 12,
  "nearest": { "icao24": "a1b2c3", "callsign": "DAL1892", "aircraftType": "A321", "registration": "N123DL", "distanceKm": 3.2, ... },
  "nearby": [ ... ],
  "fetchedAt": "2026-09-06T18:20:00.000Z"
}
```

## ACARS messages (optional)

The widget can show recent ACARS datalink messages for the aircraft overhead. This is off by default and needs an [airframes.io](https://airframes.io/) key:

```bash
AIRFRAMES_API_KEY=your-key npm start
```

`AIRFRAMES_API_URL` overrides the endpoint if it differs from the default.

Two things to be realistic about:

- **Most flights will show nothing.** ACARS is only received where a volunteer has a receiver listening, so empty results are the normal case, not an error. The widget says so rather than looking broken.
- **The upstream response shape is not pinned down here.** Field names are read defensively (several spellings per field). If a real response doesn't parse, request `/api/acars?flight=XXX&debug=1` to see the raw upstream payload and adjust `normalizeAcarsMessage` in `server.js`.

`GET /api/acars?flight=<callsign>&reg=<registration>` returns `{ configured, count, messages[] }`, where each message carries `timestamp`, `label`, `text`, `station` and `link`.

## Notes

- Tries adsb.fi first, then adsb.lol — both free community ADS-B feeds, no signup. The server caches responses per-location for 8 seconds to be a good citizen.
- **These feeds want to know who's calling.** adsb.lol rejects requests with a generic User-Agent, so every outbound request identifies itself as `Overhead/1.0 (+<contact>)`. That contact defaults to this repo's URL; set `CONTACT_URL` to point somewhere that reaches you if you're running your own deployment.
- **airplanes.live is not in the chain.** It returns 403 to unregistered callers and asks you to email contact@airplanes.live describing your project. If they grant access, add it back to `PROVIDERS` in `server.js`.
- `GET /api/overhead?...&debug=1` probes every provider and reports each one's status, top-level JSON keys and a body preview — the fastest way to tell a blocked request from a changed response shape.
- This project originally used the OpenSky Network API, but its anonymous access has become unreliable (tight rate limits, push toward registered OAuth clients), so it was swapped out.
- If your environment blocks outbound requests to these hosts, the widget will show a fetch error — this is a network/firewall restriction, not a bug in the app.
