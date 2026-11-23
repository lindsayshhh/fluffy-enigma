"""Repackage binary assets as JSON so any static host (including claude.ai
artifacts, which won't serve .bin/.fbx) can serve them.

- models/<name>/<name>.gltf + .bin  -> models/<name>/<name>.json (glTF with the buffer embedded)
- people/<Avatar>/<Avatar>.fbx      -> people/<Avatar>/model.json  {"format": "fbx", "base64": ...}
- people/animations.json + .bin     -> people/animations.json      {"clips": [...], "base64": ...}
Safe to re-run: files already converted are skipped.
"""
import base64, glob, json, os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets')
b64 = lambda path: base64.b64encode(open(path, 'rb').read()).decode('ascii')

for gltf in glob.glob(os.path.join(ROOT, 'models', '*', '*.gltf')):
    doc = json.load(open(gltf))
    folder = os.path.dirname(gltf)
    for buf in doc.get('buffers', []):
        uri = buf.get('uri', '')
        if uri and not uri.startswith('data:'):
            buf['uri'] = 'data:application/octet-stream;base64,' + b64(os.path.join(folder, uri))
            os.remove(os.path.join(folder, uri))
    json.dump(doc, open(gltf[:-5] + '.json', 'w'), separators=(',', ':'))
    os.remove(gltf)
    print('model', os.path.basename(gltf))

for fbx in glob.glob(os.path.join(ROOT, 'people', '*', '*.fbx')):
    json.dump({'format': 'fbx', 'base64': b64(fbx)}, open(os.path.join(os.path.dirname(fbx), 'model.json'), 'w'))
    os.remove(fbx)
    print('avatar', os.path.basename(fbx))

anim_bin = os.path.join(ROOT, 'people', 'animations.bin')
if os.path.exists(anim_bin):
    anim_json = os.path.join(ROOT, 'people', 'animations.json')
    clips = json.load(open(anim_json))
    json.dump({'clips': clips, 'base64': b64(anim_bin)}, open(anim_json, 'w'), separators=(',', ':'))
    os.remove(anim_bin)
    print('animations')
