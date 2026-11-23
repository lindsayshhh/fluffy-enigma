# Palmera Cay

A first-person vacation game. You're a guest on a small tropical island for three days. Your goal is to have as much **fun** and be as **relaxed** as possible before the boat leaves, with help from the island's residents (and despite one seagull).

It runs in the browser on [three.js](https://threejs.org/), with no build step. The island, palms, water and sound are generated in code; surfaces and a few props use photoscanned textures and models from [Poly Haven](https://polyhaven.com) (CC0), and the characters are realistic, motion-captured avatars from the [Microsoft Rocketbox library](https://github.com/microsoft/Microsoft-Rocketbox) (MIT). The palms, tropical plants and sun loungers are Sketchfab models by Next Spring, evolveduk, MozzarellaARC and nonsenseblve (CC BY 4.0). See [`assets/CREDITS.md`](assets/CREDITS.md). If any of those files are missing, the game falls back to its procedural look.

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

### Things to do

- **Kayak**: take one from the rack on the beach east of the dock. `W`/`S` paddles, `A`/`D` steers, and `E` near any beach climbs out. Somewhere along the rocky eastern headland is a hidden cove worth finding.
- **Fishing**: at the end of the dock, from 6 am to 8 pm. Strike with `Space` when the bobber dips. The sea gives up some odd things, and at least one of them belongs to somebody.
- **The last night**: on day 3 there's a bonfire on the main beach from 7:30 pm. Everyone comes, and how their evening goes depends on what you did together.

### Weather and nights

- Tropical showers roll in a few times over the trip: the sky goes grey, the sand turns dark and glossy, and everyone runs for the bar. Late-afternoon showers leave a rainbow behind (rainbows need the sun below 42°, as in real life). The last evening is always clear.
- On dark nights the sea is full of bioluminescent plankton that light up where you swim or paddle, and you can lie on the dock and watch for shooting stars.

### Phones and tablets

On a touch screen the game shows on-screen controls: a joystick wherever your left thumb lands (push it all the way to run, and it paddles the kayak too), drag with your right thumb to look, and a yellow button for whatever you can do right now. Jump, Dive (while swimming), Journal and Pause have their own buttons. Touch devices start on the Low graphics setting. Hold the device sideways.

One in-game hour lasts 45 real seconds, so a full day takes about ten minutes.

## The locals

- **Dez** runs The Salty Coconut. He doesn't make drinks; he makes diagnoses, then drinks.
- **Brenda Pike** from Dayton, Ohio has a laminated itinerary and has never once lain down for no reason.
- **Captain Lorenzo Bellamy** runs snorkel tours on *The Unsinkable II*. Do not ask about *The Unsinkable I*.
- **Gary Lindqvist** has been trying to send one email for four days.
- **Marisol Vega-Sun** leads sunset yoga and will tell you about your aura whether you ask or not.
- **Nana Pearl**, 84, plays beach volleyball and is undefeated since Tuesday.
- **Skye Marlowe** is a lifestyle creator with 412 very engaged followers. She has been on the south beach for six hours and has not touched the water, only its hashtag.
- **Kevin** is a seagull. Kevin wants your churro.

## Code layout

| File | What it does |
| --- | --- |
| `src/assets.js` | Loads the Poly Haven textures and models |
| `src/terrain.js` | Island height field, terrain texture blending (sand, wet sand, grass, rock), underwater caustics |
| `src/water.js` | Wave shader (depth-tinted shallows, Fresnel reflections, sun glitter, shoreline foam) and the matching wave height in JS |
| `src/sky.js` | Physical sky, sun/moon lighting through the day, stars, clouds, environment lighting |
| `src/props.js` | Palms, grass, flowers, rocks, reef, fish, turtle and every building; collision and walkable surfaces |
| `src/layout.js` | Where everything sits, derived from the real shoreline |
| `src/humans.js` | Realistic Rocketbox characters: loading, animation blending, head tracking, lip movement and blinking, props |
| `src/weather.js` | Showers, wet ground, rain sound cues, the overcast veil and rainbows |
| `src/touch.js` | On-screen joystick, drag-to-look and buttons for touch screens |
| `src/post.js` | Post-processing: ambient occlusion, bloom, depth of field in conversations, colour grade, vignette, film grain |
| `src/people.js` | Fallback procedural characters, and Kevin |
| `tools/` | Scripts that converted the Rocketbox textures and animations for the web |
| `src/dialogue.js` | Every conversation, as data |
| `src/game.js` | Meters, time, schedules, interactions, events, scoring |
| `src/player.js` | First-person movement, swimming and diving |
| `src/ui.js` | HUD, dialogue, narration, minigames, postcards |
| `src/audio.js` | Synthesised surf, wind, birds, crickets and the steel-pan loop at the bar |

`vendor/` holds an unmodified copy of three.js r170 and the addons it uses (MIT licence, see `vendor/LICENSE`). `assets/` holds the Poly Haven and Rocketbox files (about 26 MB in total).

The Graphics setting in the pause menu switches between **High** (ambient occlusion, depth of field, sharper resolution) and **Low** (faster, for older laptops).

Add `?hour=17.5` to the URL to start at a particular time of day.
