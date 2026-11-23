"""Convert downloaded Sketchfab .glb files into the game's asset format:
glTF JSON with the geometry buffer embedded as base64 (servable by any
static host) and textures as separate, downsized JPEG/PNG files.

Usage: python3 tools/sketchfab_convert.py <model.glb> <out folder> [max texture size] [mesh names to drop...]
"""
import base64
import io
import json
import os
import struct
import sys

from PIL import Image


def read_glb(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF', 'not a GLB file'
    off, doc, binc = 12, None, b''
    while off < len(b):
        ln, typ = struct.unpack('<I4s', b[off:off + 8])
        chunk = b[off + 8:off + 8 + ln]
        if typ == b'JSON':
            doc = json.loads(chunk)
        else:
            binc = chunk
        off += 8 + ln
    return doc, binc


def convert(src, out, max_size=1024, drop=()):
    doc, binc = read_glb(src)
    os.makedirs(os.path.join(out, 'textures'), exist_ok=True)
    name = os.path.basename(out.rstrip('/'))

    # Drop unwanted meshes (backdrops, light cards) by name.
    for node in doc['nodes']:
        if 'mesh' in node and doc['meshes'][node['mesh']].get('name', '') in drop:
            del node['mesh']

    image_views = set()
    for i, im in enumerate(doc.get('images', [])):
        bv = doc['bufferViews'][im['bufferView']]
        image_views.add(im['bufferView'])
        start = bv.get('byteOffset', 0)
        pic = Image.open(io.BytesIO(binc[start:start + bv['byteLength']]))
        has_alpha = pic.mode in ('RGBA', 'LA') or (pic.mode == 'P' and 'transparency' in pic.info)
        pic = pic.convert('RGBA' if has_alpha else 'RGB')
        if max(pic.size) > max_size:
            k = max_size / max(pic.size)
            pic = pic.resize((max(1, round(pic.width * k)), max(1, round(pic.height * k))), Image.LANCZOS)
        fname = f'textures/{name}_{i}.' + ('png' if has_alpha else 'jpg')
        if has_alpha:
            pic.save(os.path.join(out, fname), optimize=True)
        else:
            pic.save(os.path.join(out, fname), 'JPEG', quality=85, optimize=True)
        im.pop('bufferView', None)
        im.pop('mimeType', None)
        im['uri'] = fname

    # Rebuild the binary buffer without the image bytes.
    new_bin = bytearray()
    remap = {}
    for i, bv in enumerate(doc['bufferViews']):
        if i in image_views:
            continue
        while len(new_bin) % 4:
            new_bin.append(0)
        start = bv.get('byteOffset', 0)
        data = binc[start:start + bv['byteLength']]
        bv['byteOffset'] = len(new_bin)
        new_bin += data
        remap[i] = len(remap)
    doc['bufferViews'] = [bv for i, bv in enumerate(doc['bufferViews']) if i not in image_views]
    for acc in doc.get('accessors', []):
        if 'bufferView' in acc:
            acc['bufferView'] = remap[acc['bufferView']]
    doc['buffers'] = [{'byteLength': len(new_bin), 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(bytes(new_bin)).decode('ascii')}]
    json.dump(doc, open(os.path.join(out, name + '.json'), 'w'), separators=(',', ':'))
    print(name, f'{len(new_bin) // 1024} KB geometry,', len(doc.get('images', [])), 'textures')


if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1024, set(sys.argv[4:]))
