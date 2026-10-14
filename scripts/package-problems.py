#!/usr/bin/env python3
"""Validate flat problem-<id>.json files and package them as a portable ZIP."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    parser.add_argument('output')
    args = parser.parse_args()
    directory, output = Path(args.directory), Path(args.output)
    files = sorted(directory.glob('problem-*.json'))
    if not files:
        parser.error('No problem-<id>.json bundles found.')
    if output.suffix.lower() != '.zip':
        parser.error('Output filename must end in .zip.')
    for file in files:
        subprocess.run(['node', str(ROOT / 'scripts/validate-problem.mjs'), str(file)], check=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=output.stem + '-', suffix='.tmp', dir=output.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for file in files:
                archive.write(file, file.name)
            report = directory / '_collection.json'
            if report.exists():
                json.loads(report.read_text(encoding='utf-8'))
                archive.write(report, report.name)
        subprocess.run(['node', str(ROOT / 'scripts/validate-problem-zip.mjs'), str(temporary)], check=True)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(str(output.resolve()))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('Packaging failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
