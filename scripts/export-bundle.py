#!/usr/bin/env python3
"""Convert a problem directory into the atomic REST import format."""
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
manifest = json.loads((root / 'manifest.json').read_text())
files = {'main.c', 'solution.h', 'solution-master.c', *manifest.get('sources', []), *manifest.get('headers', [])}
print(json.dumps({
    'manifest': manifest,
    'description': (root / 'description.md').read_text(),
    'files': {name: (root / name).read_text() for name in sorted(files)},
    'tests': json.loads((root / 'tests.json').read_text())
}, ensure_ascii=False, indent=2))
