# Palmera Cay

A first-person vacation game. You're a guest on a small tropical island for three days. Your goal is to have as much **fun** and be as **relaxed** as possible before the boat leaves, with help from the island's residents (and despite one seagull).

It runs in the browser on [three.js](https://threejs.org/), with no build step and no assets to download: the island, the palms, the water, the people and the sound are all generated in code.

## Run it

```bash
npm run island
```

Then open http://localhost:8080. Any static file server works too (`python3 -m http.server -d island`). It needs to be served over HTTP, because opening `index.html` straight from disk blocks the ES modules.

Play it on a computer with a mouse and keyboard, with sound on.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Walk |
| Mouse | Look (click the game to capture the mouse) |
| `Shift` | Run (burns energy) |
| `Space` | Jump; climb out of the water onto a dock or deck |
| `C` | Dive while swimming |
| `E` | Talk / interact |
| `1`–`4` | Pick a dialogue choice |
| `J` | Journal (leads and memories) |
| `H` | Hide the HUD (for screenshots) |
| `Esc` | Pause and settings |

## How it plays

- **Fun** and **Relaxation** slowly drain over time. Fill them up by doing things and talking to people.
- **Vacation bliss** (your score) builds every minute in proportion to fun × relaxation, so you score most by being happy *and* calm at the same time. Each **memory** you make adds a bonus.
- **Energy** drains as you go. Nap in your bungalow, lie in the hammock or eat. If it hits zero you fall asleep where you stand.
- **Sunburn** builds in direct midday sun. Shade, sunscreen (there's a bottle on your bungalow deck) and time out of the sun all help. A bad sunburn makes it hard to relax.
- Doing the same thing over and over gets less rewarding each time on the same day.
- Your **work phone** buzzes every hour or two. You can read it, ignore it, or find a more permanent solution.
- A day ends when you go to sleep (bed in Bungalow 7, after 8 pm), pass out, or stay up past 2 am. After three days you get a final rating.

One in-game hour lasts 45 real seconds, so a full day takes about ten minutes.

## The locals

- **Dez** runs The Salty Coconut. He doesn't make drinks; he makes diagnoses, then drinks.
- **Brenda Pike** from Dayton, Ohio has a laminated itinerary and has never once lain down for no reason.
- **Captain Lorenzo Bellamy** runs snorkel tours on *The Unsinkable II*. Do not ask about *The Unsinkable I*.
- **Gary Lindqvist** has been trying to send one email for four days.
- **Marisol Vega-Sun** leads sunset yoga and will tell you about your aura whether you ask or not.
- **Nana Pearl**, 84, plays beach volleyball and is undefeated since Tuesday.
- **Kevin** is a seagull. Kevin wants your churro.

## Code layout

| File | What it does |
| --- | --- |
| `src/terrain.js` | Island height field, vertex-coloured terrain, sand grain and underwater caustics |
| `src/water.js` | Wave shader (depth-tinted shallows, Fresnel reflections, sun glitter, shoreline foam) and the matching wave height in JS |
| `src/sky.js` | Physical sky, sun/moon lighting through the day, stars, clouds, environment lighting |
| `src/props.js` | Palms, grass, flowers, rocks, reef, fish, turtle and every building; collision and walkable surfaces |
| `src/layout.js` | Where everything sits, derived from the real shoreline |
| `src/people.js` | The characters and Kevin |
| `src/dialogue.js` | Every conversation, as data |
| `src/game.js` | Meters, time, schedules, interactions, events, scoring |
| `src/player.js` | First-person movement, swimming and diving |
| `src/ui.js` | HUD, dialogue, narration, minigames, postcards |
| `src/audio.js` | Synthesised surf, wind, birds, crickets and the steel-pan loop at the bar |

`vendor/` holds an unmodified copy of three.js r170 (MIT licence, see `vendor/LICENSE`).

Add `?hour=17.5` to the URL to start at a particular time of day.
