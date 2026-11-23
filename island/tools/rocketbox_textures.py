"""Convert Microsoft Rocketbox avatar textures (2K TGA) into web-sized files.

Usage: python3 tools/rocketbox_textures.py <path to Microsoft-Rocketbox checkout>
Writes island/assets/people/<Avatar>/{body,head}_{color,normal}.jpg and opacity.png
and the avatar FBX (as base64 in model.json) next to them.
"""
import base64, glob, json, os, sys
from PIL import Image

AVATARS = {
    'Male_Adult_12': 'Adults', 'Female_Adult_01': 'Adults', 'Male_Adult_14': 'Adults',
    'Male_Adult_08': 'Adults', 'Female_Adult_03': 'Adults', 'Female_Adult_14': 'Adults',
    'Sports_Female_01': 'Professions', 'Sports_Male_01': 'Professions', 'Female_Party_01': 'Adults',
}
src_root = os.path.join(sys.argv[1], 'Assets', 'Avatars')
out_root = os.path.join(os.path.dirname(__file__), '..', 'assets', 'people')

for name, group in AVATARS.items():
    src = os.path.join(src_root, group, name)
    out = os.path.join(out_root, name)
    os.makedirs(out, exist_ok=True)
    # The FBX ships as base64 inside JSON so any static host will serve it.
    fbx = open(os.path.join(src, 'Export', name + '.fbx'), 'rb').read()
    json.dump({'format': 'fbx', 'base64': base64.b64encode(fbx).decode('ascii')}, open(os.path.join(out, 'model.json'), 'w'))
    made = []
    for part in ('body', 'head'):
        for kind in ('color', 'normal'):
            files = glob.glob(os.path.join(src, 'Textures', f'*_{part}_{kind}.tga'))
            if not files:
                continue
            im = Image.open(files[0]).convert('RGB').resize((1024, 1024), Image.LANCZOS)
            im.save(os.path.join(out, f'{part}_{kind}.jpg'), 'JPEG', quality=86, optimize=True)
            made.append(f'{part}_{kind}')
    files = glob.glob(os.path.join(src, 'Textures', '*_opacity_color.tga'))
    if files:
        im = Image.open(files[0]).convert('RGBA').resize((1024, 1024), Image.LANCZOS)
        im.save(os.path.join(out, 'opacity.png'), optimize=True)
        made.append('opacity')
    print(name, ', '.join(made))
