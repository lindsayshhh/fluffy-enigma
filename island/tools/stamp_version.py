"""Stamp a build version into index.html so browsers fetch fresh game code.

Every module under src/ is mapped to `src/<file>.js?v=<version>` in the
import map (imports between modules resolve to the plain path and are
remapped), the entry script carries the same query, and the title screen
shows the version.

Usage: python3 tools/stamp_version.py <version>
"""
import glob, json, os, re, sys

version = sys.argv[1]
root = os.path.join(os.path.dirname(__file__), '..')
path = os.path.join(root, 'index.html')
html = open(path).read()

imports = {'three': './vendor/three.module.js', 'three/addons/': './vendor/addons/'}
for f in sorted(glob.glob(os.path.join(root, 'src', '*.js'))):
    name = os.path.basename(f)
    imports[f'./src/{name}'] = f'./src/{name}?v={version}'
mapjson = json.dumps({'imports': imports}, indent=2)
html = re.sub(r'<script type="importmap">.*?</script>', '<script type="importmap">\n' + mapjson + '\n    </script>', html, flags=re.S)
html = re.sub(r'<script type="module" src="src/main\.js[^"]*"></script>', f'<script type="module" src="src/main.js?v={version}"></script>', html)
html = re.sub(r'<p class="build">.*?</p>', f'<p class="build">Build {version}</p>', html)
if '<p class="build">' not in html:
    html = html.replace('</p>\n      </div>\n    </div>\n\n    <script type="module"', f'</p>\n        <p class="build">Build {version}</p>\n      </div>\n    </div>\n\n    <script type="module"', 1)
open(path, 'w').write(html)
print('stamped', version)
