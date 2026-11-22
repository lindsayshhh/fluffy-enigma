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

Textures were downsized from 2K TGA to 1K JPEG/PNG with `tools/rocketbox_textures.py`, and 15 animations were trimmed, quantised and packed into `animations.bin` with `tools/rocketbox_animations.mjs`.

| Role | Avatar |
| --- | --- |
| Dez | Male_Adult_12 |
| Brenda Pike | Female_Adult_01 |
| Captain Lorenzo | Male_Adult_14 |
| Gary | Male_Adult_08 |
| Marisol | Female_Adult_03 |
| Nana Pearl | Female_Adult_14 |
| Beachgoers | Sports_Female_01, Sports_Male_01, Female_Party_01 |
