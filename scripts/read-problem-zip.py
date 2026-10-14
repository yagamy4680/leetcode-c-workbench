#!/usr/bin/env python3
"""Read a bounded problem ZIP from stdin without extracting any archive paths."""
import io
import json
from pathlib import PurePosixPath
import re
import stat
import sys
import zipfile

MAX_ARCHIVE = 32 * 1024 * 1024
MAX_FILE = 12 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
MAX_PROBLEMS = 100


def read_archive(raw):
    if len(raw) > MAX_ARCHIVE:
        raise ValueError('ZIP exceeds 32 MiB.')
    entries, total, names, ids = [], 0, set(), set()
    report = None
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        if len(infos) > 300:
            raise ValueError('ZIP contains too many entries (maximum 300).')
        for info in infos:
            name = info.filename
            parts = name.rstrip('/').split('/')
            if not name or name.startswith('/') or '\\' in name or any(part in ('', '.', '..') or ':' in part for part in parts):
                raise ValueError('Unsafe archive path: ' + name)
            if stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError('ZIP symlinks are not supported.')
            if info.flag_bits & 1:
                raise ValueError('Encrypted ZIP entries are not supported.')
            if name in names:
                raise ValueError('Duplicate ZIP entry: ' + name)
            names.add(name)
            if info.is_dir():
                continue
            if info.file_size > MAX_FILE:
                raise ValueError('ZIP entry exceeds 12 MiB: ' + name)
            total += info.file_size
            if total > MAX_EXPANDED:
                raise ValueError('Expanded ZIP exceeds 64 MiB.')
            if parts[0] == '__MACOSX' or parts[-1] == '.DS_Store':
                continue
            if parts[-1] == '_collection.json':
                if report is not None:
                    raise ValueError('Only one _collection.json report is supported.')
                report = json.loads(archive.read(info).decode('utf-8'))
                if not isinstance(report, dict) or not isinstance(report.get('unavailable', []), list) or len(report.get('unavailable', [])) > 100:
                    raise ValueError('Invalid _collection.json report.')
                for item in report.get('unavailable', []):
                    if not isinstance(item, dict) or not isinstance(item.get('slug'), str) or not isinstance(item.get('reason'), str):
                        raise ValueError('Report unavailable items require slug and reason strings.')
                continue
            match = re.fullmatch(r'problem(?:-(\d+))?\.json', PurePosixPath(name).name)
            if not match:
                raise ValueError('Expected problem-<id>.json or problem.json: ' + name)
            if len(entries) >= MAX_PROBLEMS:
                raise ValueError('ZIP contains more than 100 problems.')
            with archive.open(info) as handle:
                data = handle.read(MAX_FILE + 1)
            if len(data) > MAX_FILE:
                raise ValueError('Expanded entry exceeds 12 MiB.')
            try:
                bundle = json.loads(data.decode('utf-8-sig'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-JSON number')))
            except (ValueError, UnicodeError):
                raise ValueError('Invalid UTF-8 JSON in ' + name)
            problem_id = bundle.get('manifest', {}).get('id') if isinstance(bundle, dict) and isinstance(bundle.get('manifest'), dict) else None
            if type(problem_id) is not int:
                raise ValueError('Missing integer manifest.id in ' + name)
            if match[1] is not None and int(match[1]) != problem_id:
                raise ValueError('Filename ID does not match manifest.id: ' + name)
            if problem_id in ids:
                raise ValueError('Duplicate problem ID in ZIP: ' + str(problem_id))
            ids.add(problem_id)
            entries.append({'path': name, 'bytes': len(data), 'bundle': bundle})
    if not entries:
        raise ValueError('ZIP contains no problem bundles.')
    if report is not None:
        if 'complete' in report and type(report['complete']) is not bool:
            raise ValueError('Report complete must be a boolean.')
        if report.get('complete') and report.get('unavailable'):
            raise ValueError('A complete report cannot list unavailable questions.')
        if 'included' in report:
            included = report['included']
            if not isinstance(included, list) or any(type(item) is not int for item in included) or len(set(included)) != len(included) or set(included) != ids:
                raise ValueError('Report included IDs must match the ZIP problem IDs.')
    return {'entries': entries, 'collectionReport': report}


def main():
    try:
        result = read_archive(sys.stdin.buffer.read(MAX_ARCHIVE + 1))
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, OSError, RuntimeError, zipfile.BadZipFile, NotImplementedError) as error:
        print(json.dumps({'error': str(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
