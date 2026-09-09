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

## Notes

- Tries airplanes.live first, then adsb.lol if that fails — both are free community ADS-B feeds with no signup. The server caches responses per-location for 8 seconds to be a good citizen.
- This project originally used the OpenSky Network API, but its anonymous access has become unreliable (tight rate limits, push toward registered OAuth clients), so it was swapped out.
- If your environment blocks outbound requests to these hosts, the widget will show a fetch error — this is a network/firewall restriction, not a bug in the app.
