# The Last Lie

A single-purpose website: it shows the most recent claim by Donald Trump that a
news organization has published a fact-check on, what's actually true, and a
link to that fact-check.

## What this is and isn't

Every entry in `data/lies.json` is tied to a published fact-check by a named
outlet, and the site links out to it. Two rules keep the site honest:

- **No invented quotes.** Claims are recorded as reported speech with the
  fact-checkers' verbatim quoted fragments preserved (`Said prices on “almost
  every item” are rapidly going down.`). Where a fact-check didn't publish the
  full sentence, this site doesn't reconstruct one.
- **Only claims rated false.** Statements that are merely unproven, disputed or
  lacking evidence are left out rather than filed under "lie."

The list is maintained by hand, so it lags the fact-checkers it cites. The page
says so, and shows how old the top entry is. For live listings, see
[PolitiFact](https://www.politifact.com/personalities/donald-trump/) and
[FactCheck.org](https://www.factcheck.org/).


## The look

The page is styled as an old television set: a wood-grain cabinet with a
speaker grille and knobs, wrapped around a curved CRT screen showing the claim
as a broadcast. On-screen there's a channel number, a blinking on-air light, a
date stamp, and the correction sits in a red chyron tab like a lower third.
Everything is monospaced, the way broadcast captions were.

The CRT effects are all CSS — no images. Scanlines are a repeating gradient,
the bulge comes from elliptical border-radii, the corner falloff and glass
highlight are layered radial gradients, and the headline carries a one-pixel
red/blue text-shadow standing in for a misregistered picture tube.

The screen powers on with a scaleY flash, a highlight band rolls slowly down
the glass, and the on-air light blinks. All of it lives inside
`prefers-reduced-motion: no-preference`, and the roll band is `display: none`
outside that block so it doesn't park mid-screen when animation is off.

The cabinet stays dark in both colour schemes, since a CRT is dark regardless.
Only the room behind it follows the viewer's light/dark preference.

## Run it

```bash
npm run start:lastlie
```

Then open http://localhost:3100. Set `PORT` to use a different port.

No build step and no dependencies — plain Node (`http`, `fs`) and vanilla
HTML/CSS/JS, matching the rest of this repo.

## Adding an entry

Add an object to the `entries` array in `data/lies.json` and bump `updated`.
Order doesn't matter; the server sorts by `date` descending, so whichever entry
has the newest date becomes the one on the front page.

```json
{
  "id": "2026-09-10-empty-seats",
  "date": "2026-09-10",
  "rating": "False",
  "claim": "Said there were “no empty seats” in the arena as he spoke.",
  "venue": "Republican midterm convention, night 2, Dallas",
  "reality": "There plainly were. Reporters in the hall described …",
  "source": {
    "name": "CNN",
    "title": "Fact check: Trump, RFK Jr. and others make false claims on night 2 …",
    "url": "https://www.cnn.com/2026/09/10/politics/…"
  }
}
```

`date`, `claim`, `reality` and a `source` with both `name` and `url` are
required — the server refuses to start without them, so a missing citation
fails loudly instead of rendering an unsourced accusation. The file is re-read
whenever it changes, so edits show up without a restart.

## API

- `GET /api/latest` — metadata plus the single newest entry.
- `GET /api/lies` — metadata plus every entry, newest first.
