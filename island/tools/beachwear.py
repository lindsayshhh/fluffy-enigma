"""Give the Rocketbox characters holiday clothes by recolouring their outfit
textures. Reads assets/people/<Avatar>/body_color.jpg and writes
body_beach.jpg next to it, keeping the fabric's folds and shading.
Safe to re-run: the original texture is never modified.

Usage: python3 tools/beachwear.py [avatar names...]
"""
import os
import sys
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'people')


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float) / 255


def hawaiian(size, base='#0d7377', petals=('#ff7b54', '#ffd166', '#f6f1e7'), leaf='#2e8b57', seed=4):
    """A tiled hibiscus print, as a float RGB array in 0..1."""
    rnd = random.Random(seed)
    tile = 256
    im = Image.new('RGB', (tile, tile), base)
    d = ImageDraw.Draw(im)
    for _ in range(18):
        x, y, s = rnd.uniform(0, tile), rnd.uniform(0, tile), rnd.uniform(12, 22)
        for dx in (-tile, 0, tile):
            for dy in (-tile, 0, tile):
                cx, cy = x + dx, y + dy
                d.ellipse([cx - s * 1.6, cy - s * 0.35, cx + s * 0.4, cy + s * 0.35], fill=leaf)
                col = rnd.choice(petals)
                for k in range(5):
                    a = k / 5 * 6.283 + rnd.uniform(0, 0.3)
                    px, py = cx + np.cos(a) * s * 0.55, cy + np.sin(a) * s * 0.55
                    d.ellipse([px - s * 0.45, py - s * 0.45, px + s * 0.45, py + s * 0.45], fill=col)
                d.ellipse([cx - s * 0.18, cy - s * 0.18, cx + s * 0.18, cy + s * 0.18], fill='#8c2f39')
    big = Image.new('RGB', (size, size))
    for x in range(0, size, tile):
        for y in range(0, size, tile):
            big.paste(im, (x, y))
    return np.asarray(big, float) / 255


def recolour(img, mask, colour):
    """Repaint masked pixels with `colour` (RGB triple or HxWx3 array), keeping
    the original's light and shadow (folds, seams, creases)."""
    a = img.astype(float) / 255
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    mean = lum[mask > 0.5].mean()
    shade = np.clip(lum / max(mean, 1e-3), 0.35, 1.5)[..., None]
    target = colour if isinstance(colour, np.ndarray) and colour.ndim == 3 else np.broadcast_to(colour, a.shape)
    painted = np.clip(target * shade, 0, 1)
    m = mask[..., None]
    return ((a * (1 - m) + painted * m) * 255).round().astype(np.uint8)


def soft(mask):
    """Feather a boolean mask by a couple of pixels so seams don't look cut out."""
    im = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))
    return np.asarray(im, float) / 255


def rect(shape, x0, x1, y0, y1):
    h, w = shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    return (xx >= x0 * w) & (xx < x1 * w) & (yy >= y0 * h) & (yy < y1 * h)


def channels(img):
    a = img.astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    return r, g, b, mx, sat


def dez(img):
    # Denim jacket -> long-sleeved Hawaiian shirt; jeans -> khaki trousers.
    # Faded denim is nearly grey, so take all fabric in these panels except
    # skin (the hands) and the white sneakers.
    r, g, b, mx, sat = channels(img)
    skin = (r > b + 25) & (r > g + 5)
    sneakers = rect(img.shape, 0.22, 0.38, 0.59, 0.93) | rect(img.shape, 0.56, 0.74, 0.59, 0.93)
    cloth = (mx > 18) & ~skin & ~sneakers
    legs = (rect(img.shape, 0, 0.28, 0, 0.47) | rect(img.shape, 0.71, 1, 0, 0.47) | rect(img.shape, 0.28, 0.72, 0.9, 1)) & cloth
    shirt = cloth & ~legs & ~rect(img.shape, 0, 1, 0.84, 1)
    img = recolour(img, soft(legs), hex_rgb('#b59f78'))
    return recolour(img, soft(shirt), hawaiian(img.shape[0]))


def brenda(img):
    # Jeans -> white capris.
    r, g, b, mx, sat = channels(img)
    return recolour(img, soft((b > r + 12) & (mx > 25)), hex_rgb('#f2efe7'))


def captain(img):
    # Grey work shirt -> crisp white captain's shirt.
    r, g, b, mx, sat = channels(img)
    grey = (sat < 0.14) & (mx > 45) & (mx < 235)
    shirt = grey & (rect(img.shape, 0.27, 0.73, 0.17, 0.92) | rect(img.shape, 0, 0.31, 0.44, 0.86) | rect(img.shape, 0.69, 1, 0.44, 0.86))
    return recolour(img, soft(shirt), hex_rgb('#f7f5ef'))


def pearl(img):
    # Beige cardigan -> bright teal athletic top.
    r, g, b, mx, sat = channels(img)
    beige = (sat < 0.22) & (mx > 70) & (r >= b - 5)
    top = beige & (rect(img.shape, 0.03, 0.97, 0.0, 0.58) | rect(img.shape, 0.27, 0.73, 0.5, 1.0)) & ~rect(img.shape, 0, 0.2, 0, 0.3) & ~rect(img.shape, 0.8, 1, 0, 0.3)
    return recolour(img, soft(top), hex_rgb('#10a7a2'))


def bare_skin(img, mask, sample):
    """Paint `mask` as bare skin, matching the avatar's own skin tone (taken
    from the `sample` area, e.g. the hands) with soft shading and a little
    grain. Returns the image and the painted mask (for flattening normals)."""
    r, g, b, mx, sat = channels(img)
    is_skin = sample & (r > b + 25) & (r > g + 5) & (r > 110)
    tone = np.median(img[is_skin].astype(float), axis=0) / 255
    lum = np.asarray(Image.fromarray(img).convert('L').filter(ImageFilter.GaussianBlur(6)), float)
    m = mask > 0.5
    rel = (lum / max(lum[m].mean(), 1) - 1) * 0.25 + 1
    noise = np.random.default_rng(3).normal(0, 0.012, img.shape[:2])
    paint = np.clip(tone[None, None, :] * (rel + noise)[..., None], 0, 1)
    a = mask[..., None]
    out = img.astype(float) / 255 * (1 - a) + paint * a
    return (out * 255).astype(np.uint8), mask


def gordon(img):
    # Tweed blazer and red jumper -> Hawaiian shirt (worn in the pool);
    # trousers -> orange board shorts above the knee, bare legs below.
    r, g, b, mx, sat = channels(img)
    skin = (r > b + 25) & (r > g + 5) & (r > 120)
    shoes = rect(img.shape, 0.2, 0.42, 0.84, 1) | rect(img.shape, 0.58, 0.8, 0.84, 1)
    cloth = (mx > 14) & ~skin & ~shoes
    leg_area = rect(img.shape, 0, 0.3, 0, 0.45) | rect(img.shape, 0.7, 1, 0, 0.45)
    legs = leg_area & cloth
    shorts = legs & rect(img.shape, 0, 1, 0, 0.235)
    shins = legs & ~shorts
    shirt = cloth & ~legs & ~rect(img.shape, 0, 1, 0.84, 1)
    img = recolour(img, soft(shorts), hawaiian(img.shape[0], base='#ff8c42', petals=('#fff3b0', '#ffffff', '#3a86ff'), leaf='#ffbe0b', seed=21))
    img = recolour(img, soft(shirt), hawaiian(img.shape[0], base='#1f6fb2', petals=('#ffd166', '#ffffff', '#ff7b54'), seed=9))
    return bare_skin(img, soft(shins), rect(img.shape, 0, 1, 0.84, 1))


def doris(img):
    # Grey cardigan -> hot-pink floral top; jeans -> white shorts, bare legs.
    r, g, b, mx, sat = channels(img)
    jeans = (b > r + 12) & (mx > 25)
    grey = (sat < 0.16) & (mx > 22) & ~jeans
    top = grey & (rect(img.shape, 0.3, 0.7, 0.0, 0.92) | rect(img.shape, 0.0, 0.3, 0.25, 0.55) | rect(img.shape, 0.7, 1.0, 0.25, 0.55))
    leg_area = rect(img.shape, 0, 0.3, 0.55, 1) | rect(img.shape, 0.7, 1, 0.55, 1)
    shorts = jeans & leg_area & rect(img.shape, 0, 1, 0, 0.74)
    shins = (jeans | ((mx > 20) & (mx < 90))) & leg_area & rect(img.shape, 0, 1, 0.74, 1)
    img = recolour(img, soft(shorts), hex_rgb('#f7f4ec'))
    # Her black shoes sit beside the top in the texture.
    sandals = (rect(img.shape, 0.17, 0.31, 0, 0.3) | rect(img.shape, 0.69, 0.83, 0, 0.3)) & (mx > 8) & ~((r > b + 25) & (r > g + 5) & (r > 110))
    img = recolour(img, soft(sandals), hex_rgb('#c8a165'))
    img = recolour(img, soft(top), hawaiian(img.shape[0], base='#e0457b', petals=('#fff3b0', '#ffffff', '#ffb4a2'), leaf='#2a9d8f', seed=12))
    return bare_skin(img, soft(shins), rect(img.shape, 0, 0.3, 0, 0.25) | rect(img.shape, 0.7, 1, 0, 0.25))


def walt(img):
    # Safari vest and field shirt -> loud parrot-coloured holiday shirt;
    # trousers -> khaki shorts; white socks with brown sandals. A classic.
    # (The khaki vest is skin-coloured, so only count the hands as skin.)
    r, g, b, mx, sat = channels(img)
    skin = (r > b + 25) & (r > g + 5) & (r > 120) & rect(img.shape, 0, 1, 0.84, 1)
    shoes = rect(img.shape, 0.2, 0.42, 0.84, 1) | rect(img.shape, 0.58, 0.8, 0.84, 1)
    cloth = (mx > 14) & ~skin & ~shoes
    leg_area = rect(img.shape, 0, 0.3, 0, 0.45) | rect(img.shape, 0.7, 1, 0, 0.45)
    legs = leg_area & cloth
    shorts = legs & rect(img.shape, 0, 1, 0, 0.235)
    socks = legs & rect(img.shape, 0, 1, 0.36, 0.45)
    shins = legs & ~shorts & ~socks
    shirt = cloth & ~legs & ~rect(img.shape, 0, 1, 0.84, 1)
    img = recolour(img, soft(shorts), hex_rgb('#cdb68a'))
    img = recolour(img, soft(socks), hex_rgb('#fbfbf7'))
    img = recolour(img, soft(shoes & (mx > 14)), hex_rgb('#6b4226'))
    img = recolour(img, soft(shirt), hawaiian(img.shape[0], base='#00a6a6', petals=('#ff595e', '#ffca3a', '#ffffff'), leaf='#1b5e20', seed=31))
    return bare_skin(img, soft(shins), rect(img.shape, 0, 1, 0.84, 1))


def chad(img):
    # Black swim trunks -> classic red lifeguard trunks.
    r, g, b, mx, sat = channels(img)
    skin = (r > b + 25) & (r > g + 5) & (r > 110)
    trunks = (rect(img.shape, 0, 0.3, 0, 0.13) | rect(img.shape, 0.7, 1, 0, 0.13)) & ~skin & (mx > 5)
    return recolour(img, soft(trunks), hex_rgb('#d62828'))


OUTFITS = {'Male_Adult_12': dez, 'Female_Adult_01': brenda, 'Male_Adult_14': captain, 'Female_Adult_14': pearl,
           'Male_Adult_03': gordon, 'Female_Adult_13': doris, 'Male_Adult_05': walt, 'Sports_Male_01': chad}

if __name__ == '__main__':
    only = set(sys.argv[1:])
    for name, fn in OUTFITS.items():
        if only and name not in only:
            continue
        src = os.path.join(ROOT, name, 'body_color.jpg')
        img = np.asarray(Image.open(src).convert('RGB'))
        out = fn(img)
        bare = None
        if isinstance(out, tuple):
            out, bare = out
        Image.fromarray(out).save(os.path.join(ROOT, name, 'body_beach.jpg'), 'JPEG', quality=86, optimize=True)
        if bare is not None:
            # Bare skin shouldn't keep the trousers' creases: flatten the normals there.
            nrm = np.asarray(Image.open(os.path.join(ROOT, name, 'body_normal.jpg')).convert('RGB'), float)
            flat = np.array([128, 128, 255], float)
            a = (bare * 0.85)[..., None]
            nrm = nrm * (1 - a) + flat * a
            Image.fromarray(nrm.astype(np.uint8)).save(os.path.join(ROOT, name, 'body_beach_normal.jpg'), 'JPEG', quality=88, optimize=True)
        print(name, 'done')
