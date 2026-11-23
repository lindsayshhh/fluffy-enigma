# Asset credits

The textures and props in `textures/` and `models/` come from [Poly Haven](https://polyhaven.com) and are released under [CC0](https://polyhaven.com/license) (public domain, no attribution required). We credit them anyway because they're great.

Downloaded at 1K resolution and recompressed as JPEG (quality 82).

## Textures (`textures/`)

Each has `_diff` (colour), `_nor` (OpenGL normal) and `_arm` (ambient occlusion / roughness / metalness) maps.

| File | Used for | Source |
| --- | --- | --- |
| `sand_01` | Dry beach sand | https://polyhaven.com/a/sand_01 |
| `damp_beach_sand` | Wet sand at the waterline and the seabed | https://polyhaven.com/a/damp_beach_sand |
| `sparse_grass` | Island interior | https://polyhaven.com/a/sparse_grass |
| `rock_ground` | Paths and the rocky hilltop | https://polyhaven.com/a/rock_ground |
| `seaside_rock` | Smaller procedural rocks | https://polyhaven.com/a/seaside_rock |
| `palm_tree_bark` | Palm trunks | https://polyhaven.com/a/palm_tree_bark |
| `thatch_roof_angled` | Bar and bungalow roofs | https://polyhaven.com/a/thatch_roof_angled |
| `wooden_planks` | Decks, dock and boardwalks | https://polyhaven.com/a/wooden_planks |
| `weathered_planks` | Walls, posts and the bar counter | https://polyhaven.com/a/weathered_planks |

## Models (`models/`)

| Folder | Used for | Source |
| --- | --- | --- |
| `lambis_shell` | Collectible shells | https://polyhaven.com/a/lambis_shell |
| `bar_chair_round_01` | Bar stools at The Salty Coconut | https://polyhaven.com/a/bar_chair_round_01 |
| `rock_07`, `rock_09` | Boulders along the shore and headland | https://polyhaven.com/a/rock_07, https://polyhaven.com/a/rock_09 |

## People (`people/`)

The characters are avatars and motion-captured animations from the [Microsoft Rocketbox avatar library](https://github.com/microsoft/Microsoft-Rocketbox), released under the MIT licence (see `people/LICENSE.md`). The library's authors ask research users to cite: Gonzalez-Franco et al., "The Rocketbox Library and the Utility of Freely Available Rigged Avatars", *Frontiers in Virtual Reality*, 2020.

Textures were downsized from 2K TGA to 1K JPEG/PNG with `tools/rocketbox_textures.py`, and 15 animations were trimmed, quantised and packed into `animations.json` with `tools/rocketbox_animations.mjs`. Binary data (model buffers, FBX files, animation data) is stored as base64 inside JSON by `tools/pack_binaries.py`, so any static host can serve it.

| Role | Avatar |
| --- | --- |
| Dez | Male_Adult_12 |
| Brenda Pike | Female_Adult_01 |
| Captain Lorenzo | Male_Adult_14 |
| Gary | Male_Adult_08 |
| Marisol | Female_Adult_03 |
| Nana Pearl | Female_Adult_14 |
| Beachgoers | Sports_Female_01, Sports_Male_01, Female_Party_01 |

## Palms, plants and loungers (`sketchfab/`)

These models come from [Sketchfab](https://sketchfab.com) under the [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) licence (CC BY 4.0). They were converted with `tools/sketchfab_convert.py`: textures downsized to 512–1024 px and the geometry repackaged as glTF JSON. In the game they are split into individual plants, rescaled and given wind sway.

| Folder | Model | Creator |
| --- | --- | --- |
| `palms` | ["Realistic Palm Tree 2 Free"](https://sketchfab.com/3d-models/realistic-palm-tree-2-free-d05c8ffb6ec64a7184c4b673e21f7224) | Next Spring |
| `coconut_palm` | ["Coconut Palm"](https://sketchfab.com/3d-models/coconut-palm-26e787f2ff2e4c0fb004c3b0210805a3) | evolveduk |
| `tropical_plants` | ["Tropical Plants Pack M02P"](https://sketchfab.com/3d-models/tropical-plants-pack-m02p-2f093afb792742438f0f7ba7eaab90f0) | MozzarellaARC |
| `lounger` | ["teak sun lounger"](https://sketchfab.com/3d-models/teak-sun-lounger-a150189e9a92485897ed2dcfc1856c17) | nonsenseblve (modified: split into frame and cushion and re-textured with wood grain and woven canvas) |
