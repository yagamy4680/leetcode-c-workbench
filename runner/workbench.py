#!/usr/bin/env python3
"""Shared native test engine. Standard-library only; no web/DB dependency."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

APP = Path(__file__).resolve().parents[1]
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
MAX_LOG = 2 * 1024 * 1024


def configure():
    env = APP / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            parts = shlex.split(value, comments=True)
            os.environ.setdefault(key.strip(), ' '.join(parts))
    configured = Path(os.environ.get('WB_DATA_DIR', '~/leetcode-workspace')).expanduser()
    data = (configured if configured.is_absolute() else APP / configured).resolve()
    if data == APP or APP in data.parents:
        raise ValueError('WB_DATA_DIR must be outside the public application repository.')
    return data


def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    tmp.write_text(content, encoding='utf-8')
    tmp.replace(path)


def write_json(path, value):
    atomic(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def context_hash(source):
    h = hashlib.sha256()
    for file in sorted(source.rglob('*')):
        if file.is_file():
            h.update(str(file.relative_to(source)).encode())
            h.update(file.read_bytes())
    return h.hexdigest()


def valid_name(value):
    if not NAME.fullmatch(str(value)):
        raise ValueError('Use 1–64 letters, digits, underscores or hyphens for names.')
    return value


def problem_path(data, problem):
    if not str(problem).isdigit() or not 1 <= int(problem) <= 999999:
        raise ValueError('Problem ID must be an integer between 1 and 999999.')
    return data / 'problems' / str(int(problem))


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def validate_tests(tests):
    if not isinstance(tests, list) or not tests:
        raise ValueError('Provide at least one test case.')
    seen = set()
    for case in tests:
        if not isinstance(case, dict) or not {'id', 'input', 'expected'} <= case.keys():
            raise ValueError('Each test requires id, input and expected.')
        valid_name(case['id'])
        if case['id'] in seen:
            raise ValueError(f'Duplicate test ID: {case["id"]}')
        seen.add(case['id'])
        if case.get('compare', 'exact') not in ('exact', 'unordered', 'float'):
            raise ValueError('Comparison must be exact, unordered or float.')
        limit = case.get('timeoutMs', 2000)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 10 <= limit <= 60000:
            raise ValueError('timeoutMs must be an integer between 10 and 60000.')
        if 'tolerance' in case and (not isinstance(case['tolerance'], (float, int)) or not math.isfinite(case['tolerance']) or case['tolerance'] < 0):
            raise ValueError('Float tolerance must be finite and non-negative.')
    return tests


def init(data):
    for name in ('problems', 'runs', 'builds', 'snapshots'):
        (data / name).mkdir(parents=True, exist_ok=True)
    for source in sorted((APP / 'examples').iterdir()):
        if source.is_dir() and source.name.isdigit():
            dest = data / 'problems' / source.name
            if not dest.exists():
                shutil.copytree(source, dest)
                solution = dest / 'solution-master.c'
                code = solution.read_text(encoding='utf-8')
                if '#define WB_DEBUG_PREAMBLE' not in code.splitlines():
                    solution.write_text((APP / 'templates/solution-preamble.c').read_text(encoding='utf-8') + code, encoding='utf-8')
    return {'dataDir': str(data), 'problems': sorted(p.name for p in (data / 'problems').iterdir() if p.is_dir() and p.name.isdigit())}


def capture(data, problem, solution, destination):
    root = problem_path(data, problem)
    valid_name(solution)
    if not root.is_dir():
        raise ValueError(f'Problem {problem} does not exist. Run ./wb.sh init first.')
    meta = read_json(root / 'manifest.json')
    # A fixed copy makes builds, reports and submissions independent of later edits.
    required = {'main.c', 'solution.h', f'solution-{solution}.c', 'manifest.json', 'tests.json'}
    required.update(meta.get('sources', []))
    required.update(meta.get('headers', []))
    required.add('description.md')
    for name in sorted(required):
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.(?:c|h|json|md)', name):
            raise ValueError(f'Invalid framework filename: {name}')
        source = root / name
        if source.is_symlink() or not source.is_file():
            raise ValueError(f'Missing or unsafe framework file: {name}')
        target = destination / 'problem' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
    shutil.copytree(APP / 'runtime', destination / 'runtime')
    return read_json(destination / 'problem' / 'manifest.json')


def compiler():
    cc = os.environ.get('CC') or shutil.which('clang') or shutil.which('cc')
    if not cc or not shutil.which(cc):
        raise ValueError('C compiler not found. On Mac install Xcode Command Line Tools or LLVM.')
    version = subprocess.run([cc, '--version'], capture_output=True, text=True, timeout=10, check=True).stdout
    return cc, version.strip()


def emit(args, event):
    if getattr(args, 'json_lines', False):
        print(json.dumps(event, ensure_ascii=False), flush=True)
    elif event['type'] == 'command':
        # Keep redirected output plain; allow the conventional color overrides.
        force = os.environ.get('FORCE_COLOR')
        colored = ('NO_COLOR' not in os.environ and force != '0' and
                   (bool(force) or (sys.stdout.isatty() and os.environ.get('TERM') != 'dumb')))
        text = '$ ' + event['text']
        print(f'\033[1;36m{text}\033[0m' if colored else text, flush=True)
    elif event['type'] == 'log':
        print(event['text'], end='', flush=True)
    elif event['type'] == 'case':
        case = event['case']
        print(f'[{case["status"]}] {case["id"]} · {case["durationMs"]} ms', flush=True)
        if case['status'] == 'wrong_answer':
            print(f'  input:    {json.dumps(case["input"], ensure_ascii=False)}\n  expected: {json.dumps(case["expected"], ensure_ascii=False)}\n  actual:   {json.dumps(case.get("actual"), ensure_ascii=False)}\n  diff:     {case.get("difference")}', flush=True)
    elif event['type'] == 'message':
        print(event['text'], flush=True)
    elif event['type'] == 'done':
        run = event['run']
        print(f'{run["status"]}: {run["passed"]}/{run["total"]} · {run["durationMs"]} ms · run {run["id"]}', flush=True)


def execute(command, cwd, stem, timeout, env, args, case=None):
    """Bounded logs and process-group cleanup, with live stdout/stderr forwarding."""
    out, err = cwd / f'{stem}.stdout.log', cwd / f'{stem}.stderr.log'
    readers = []
    reason = None
    started = time.monotonic()
    with out.open('wb') as stdout, err.open('wb') as stderr:
        proc = subprocess.Popen(command, cwd=cwd, stdout=stdout, stderr=stderr, env=env, start_new_session=True)
        try:
            readers = [out.open('rb'), err.open('rb')]
            while True:
                for stream, reader in zip(('stdout', 'stderr'), readers):
                    chunk = reader.read(65536)
                    if chunk:
                        emit(args, {'type': 'log', 'stream': stream, 'case': case, 'text': chunk.decode('utf-8', errors='replace')})
                if out.stat().st_size + err.stat().st_size > MAX_LOG:
                    reason = 'output_limit'
                elif time.monotonic() - started > timeout:
                    reason = 'timeout'
                if reason:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
                    break
                if proc.poll() is not None:
                    # A completed process may have left descendants holding resources.
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    break
                time.sleep(0.02)
            for stream, reader in zip(('stdout', 'stderr'), readers):
                chunk = reader.read(MAX_LOG)
                if chunk:
                    emit(args, {'type': 'log', 'stream': stream, 'case': case, 'text': chunk.decode('utf-8', errors='replace')})
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
            for reader in readers:
                reader.close()
    for log in (out, err):
        if log.stat().st_size > MAX_LOG:
            with log.open('r+b') as handle:
                handle.truncate(MAX_LOG)
    return proc.returncode, reason, round((time.monotonic() - started) * 1000)


def doctor(data, refresh=False):
    data.mkdir(parents=True, exist_ok=True)
    cc, version = compiler()
    key = digest((cc + version).encode())
    cache = data / 'builds' / f'doctor-{key}.json'
    if cache.exists() and not refresh:
        return read_json(cache)
    result = {'compiler': cc, 'version': version, 'addressSanitizer': False, 'undefinedSanitizer': False, 'leakSanitizer': False}
    with tempfile.TemporaryDirectory(prefix='wb-doctor-') as directory:
        tmp = Path(directory)
        probe = tmp / 'probe.c'
        probe.write_text('#include <stdlib.h>\n__attribute__((noinline)) void leak(void) { char *p=malloc(31); if(p) *(volatile char *)p=1; }\nint main(void) { leak(); return 0; }\n')
        binary = tmp / 'probe'
        base = [cc, '-g', '-O0']
        if sys.platform.startswith('linux'):
            base.append('-no-pie')
        for name, sanitizer in (('addressSanitizer', 'address'), ('undefinedSanitizer', 'undefined')):
            built = subprocess.run(base + [f'-fsanitize={sanitizer}', str(probe), '-o', str(binary)], capture_output=True, timeout=30)
            if built.returncode == 0:
                env = {**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0'}
                ran = subprocess.run([str(binary)], capture_output=True, env=env, timeout=10)
                result[name] = ran.returncode == 0
        built = subprocess.run(base + ['-fsanitize=address', str(probe), '-o', str(binary)], capture_output=True, timeout=30)
        if built.returncode == 0:
            env = {**os.environ, 'ASAN_OPTIONS': 'detect_leaks=1'}
            ran = subprocess.run([str(binary)], capture_output=True, env=env, timeout=10)
            result['leakSanitizer'] = b'LeakSanitizer: detected memory leaks' in ran.stderr
            result['leakProbeLog'] = ran.stderr.decode(errors='replace')[:4000]
    write_json(cache, result)
    return result


def first_difference(expected, actual, path='$', tolerance=None):
    if tolerance is not None and type(expected) in (int, float) and type(actual) in (int, float):
        return None if math.isfinite(actual) and math.isclose(expected, actual, rel_tol=tolerance, abs_tol=tolerance) else path
    if type(expected) is not type(actual):
        return path + ' (type differs)'
    if isinstance(expected, list):
        if len(expected) != len(actual):
            return path + f' (length {len(expected)} != {len(actual)})'
        for index, (a, b) in enumerate(zip(expected, actual)):
            diff = first_difference(a, b, f'{path}[{index}]', tolerance)
            if diff:
                return diff
        return None
    if isinstance(expected, dict):
        if expected.keys() != actual.keys():
            return path + ' (keys differ)'
        for key in expected:
            diff = first_difference(expected[key], actual[key], f'{path}.{key}', tolerance)
            if diff:
                return diff
        return None
    return None if expected == actual else path


def compare(case, actual):
    expected = case['expected']
    mode = case.get('compare', 'exact')
    if mode == 'unordered':
        if not isinstance(expected, list) or not isinstance(actual, list):
            return '$ (unordered comparison requires arrays)'
        expected = sorted(expected, key=lambda x: json.dumps(x, sort_keys=True))
        actual = sorted(actual, key=lambda x: json.dumps(x, sort_keys=True))
    return first_difference(expected, actual, tolerance=case.get('tolerance', 1e-6) if mode == 'float' else None)


def run(data, args):
    started = time.monotonic()
    run_id = uuid.uuid4().hex
    folder = data / 'runs' / run_id
    folder.mkdir(parents=True)
    meta = capture(data, args.problem, args.solution, folder / 'source')
    source = folder / 'source' / 'problem'
    runtime = folder / 'source' / 'runtime'
    tests = validate_tests(read_json(source / 'tests.json'))
    if args.case:
        tests = [case for case in tests if case['id'] == args.case]
        if not tests:
            raise ValueError(f'Test case {args.case} does not exist.')
    cc, version = compiler()
    capabilities = doctor(data) if args.mode == 'debug' else {'leakSanitizer': False}
    if args.mode == 'debug' and not (capabilities['addressSanitizer'] and capabilities['undefinedSanitizer']):
        raise ValueError('Compiler does not support ASan/UBSan. Select a supported compiler or --mode perf.')
    flags = ['-std=gnu11', '-g', '-Wall', '-Wextra', '-Werror=implicit-function-declaration', '-fno-omit-frame-pointer']
    if args.mode == 'debug':
        flags += ['-DDEBUG', '-O1', '-fsanitize=address,undefined', '-fno-sanitize-recover=all']
        if sys.platform.startswith('linux'):
            flags.append('-no-pie')
    else:
        flags.append('-O2')
    hash_inputs = hashlib.sha256((cc + version + json.dumps(flags) + json.dumps(meta.get('sources', ['main.c']))).encode())
    # Only compile-related files belong to the build key: cases do not invalidate it.
    for path in sorted((folder / 'source').rglob('*')):
        if path.is_file() and path.suffix in ('.c', '.h'):
            hash_inputs.update(str(path.relative_to(folder / 'source')).encode())
            hash_inputs.update(path.read_bytes())
    build_hash = hash_inputs.hexdigest()
    build = data / 'builds' / build_hash
    build.mkdir(parents=True, exist_ok=True)
    source_hash = digest((source / f'solution-{args.solution}.c').read_bytes())
    if getattr(args, 'expected_hash', None) and args.expected_hash != source_hash:
        raise ValueError('Solution changed before capture. Reload and run again.')
    report = {'id': run_id, 'problemId': int(args.problem), 'solution': args.solution, 'sourceHash': source_hash,
              'buildHash': build_hash, 'contextHash': context_hash(folder / 'source'), 'testsHash': digest((source / 'tests.json').read_bytes()), 'mode': args.mode, 'compiler': version, 'flags': flags,
              'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'status': 'running', 'passed': 0,
              'total': len(tests), 'cases': [], 'leakCheck': 'enabled' if args.mode == 'debug' and capabilities['leakSanitizer'] else ('unavailable' if args.mode == 'debug' else 'disabled'), 'cached': False}
    write_json(folder / 'result.json', report)
    emit(args, {'type': 'start', 'run': report})
    env = {**os.environ, 'ASAN_OPTIONS': f'detect_leaks={int(args.mode == "debug" and capabilities["leakSanitizer"])}', 'UBSAN_OPTIONS': 'print_stacktrace=1:halt_on_error=1'}
    symbolizer = Path(cc).with_name('llvm-symbolizer')
    if symbolizer.is_file():
        env.setdefault('ASAN_SYMBOLIZER_PATH', str(symbolizer))
    with (build / 'build.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        binary = build / 'program'
        if binary.exists():
            report['cached'] = True
            for stream in ('stdout', 'stderr'):
                cached = build / f'compile.{stream}.log'
                if cached.exists():
                    shutil.copyfile(cached, folder / cached.name)
        else:
            sources = meta.get('sources', ['main.c'])
            if 'main.c' not in sources or any(not re.fullmatch(r'[A-Za-z0-9_-]+\.c', s) or s.startswith('solution-') for s in sources):
                raise ValueError('sources must include main.c and only framework .c files.')
            pending = build / 'program.tmp'
            command = [cc, *flags, '-I', str(runtime), '-I', str(source), '-include', str(source / 'solution.h'),
                       *(str(source / s) for s in sources), str(source / f'solution-{args.solution}.c'), str(runtime / 'wb.c'), '-lm', '-o', str(pending)]
            report['command'] = command
            emit(args, {'type': 'command', 'argv': command, 'text': shlex.join(command)})
            code, reason, _ = execute(command, folder, 'compile', 30, env, args)
            if code != 0 or reason:
                report['status'] = 'compile_error'
                report['compileReason'] = reason
            else:
                if sys.platform == 'darwin' and shutil.which('dsymutil'):
                    subprocess.run(['dsymutil', str(pending)], capture_output=True, timeout=30)
                    dsym = build / 'program.tmp.dSYM'
                    if dsym.exists():
                        dsym.rename(build / 'program.dSYM')
                        dwarf = build / 'program.dSYM' / 'Contents' / 'Resources' / 'DWARF' / 'program.tmp'
                        if dwarf.exists():
                            dwarf.rename(dwarf.with_name('program'))
                pending.replace(binary)
                for stream in ('stdout', 'stderr'):
                    shutil.copyfile(folder / f'compile.{stream}.log', build / f'compile.{stream}.log')
    if report['status'] != 'compile_error':
        emit(args, {'type': 'message', 'text': f'Build {"cached" if report["cached"] else "complete"} · leak check {report["leakCheck"]}'})
        for case in tests:
            case_dir = folder / 'cases' / case['id']
            case_dir.mkdir(parents=True)
            write_json(case_dir / 'input.json', case['input'])
            code, reason, duration = execute([str(binary), str(case_dir / 'input.json'), str(case_dir / 'actual.json')], case_dir, 'run', case.get('timeoutMs', 2000) / 1000, env, args, case['id'])
            outcome = {'id': case['id'], 'input': case['input'], 'expected': case['expected'], 'exitCode': code, 'durationMs': duration}
            errors = (case_dir / 'run.stderr.log').read_text(errors='replace')
            if reason:
                outcome['status'] = reason
            elif code == 70 or 'Driver error:' in errors:
                # Invalid input can exit before cleanup; LSan may also report it.
                outcome['status'] = 'driver_error'
            elif 'LeakSanitizer: detected memory leaks' in errors:
                outcome['status'] = 'memory_leak'
            elif 'ERROR: AddressSanitizer' in errors or 'AddressSanitizer:DEADLYSIGNAL' in errors:
                outcome['status'] = 'memory_error'
            elif 'runtime error:' in errors:
                outcome['status'] = 'undefined_behavior'
            elif code != 0:
                outcome['status'] = 'driver_error' if code == 70 else 'runtime_error'
            else:
                try:
                    if (case_dir / 'actual.json').stat().st_size > MAX_LOG:
                        raise ValueError('Result exceeds size limit.')
                    outcome['actual'] = read_json(case_dir / 'actual.json')
                    outcome['difference'] = compare(case, outcome['actual'])
                    outcome['status'] = 'wrong_answer' if outcome['difference'] else 'passed'
                except (OSError, ValueError) as exc:
                    outcome['status'] = 'driver_error'
                    outcome['error'] = str(exc)
            report['cases'].append(outcome)
            report['passed'] += int(outcome['status'] == 'passed')
            write_json(folder / 'result.json', report)
            emit(args, {'type': 'case', 'case': outcome})
        report['status'] = 'passed' if report['passed'] == report['total'] else 'failed'
    report['durationMs'] = round((time.monotonic() - started) * 1000)
    write_json(folder / 'result.json', report)
    emit(args, {'type': 'done', 'run': report})
    return report


def snapshot(data, problem, solution):
    snapshot_id = uuid.uuid4().hex
    repo = data / 'snapshots'
    repo.mkdir(parents=True, exist_ok=True)
    with (repo / '.snapshot.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not (repo / '.git').exists():
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            (repo / '.gitignore').write_text('.snapshot.lock\n')
        target = repo / snapshot_id
        capture(data, problem, solution, target)
        captured_hash = context_hash(target)
        code = (target / 'problem' / f'solution-{solution}.c').read_text()
        atomic(target / 'submission.c', code)
        metadata = {'id': snapshot_id, 'problemId': int(problem), 'solution': solution, 'sourceHash': digest(code.encode()), 'contextHash': captured_hash, 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat()}
        write_json(target / 'snapshot.json', metadata)
        subprocess.run(['git', '-C', str(repo), 'add', '--', snapshot_id, '.gitignore'], check=True)
        subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Workbench', '-c', 'user.email=workbench@localhost', 'commit', '-q', '-m', f'Snapshot {problem}/{solution} {snapshot_id}'], check=True)
        metadata['commitSha'] = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
        return {**metadata, 'code': code}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('init')
    doc = sub.add_parser('doctor')
    doc.add_argument('--refresh', action='store_true')
    snap = sub.add_parser('snapshot')
    snap.add_argument('problem', type=int)
    snap.add_argument('solution', nargs='?', default='master')
    test = sub.add_parser('run')
    test.add_argument('problem', type=int)
    test.add_argument('solution', nargs='?', default='master')
    test.add_argument('--case')
    test.add_argument('--mode', choices=('debug', 'perf'), default='debug')
    test.add_argument('--watch', action='store_true')
    test.add_argument('--json-lines', action='store_true')
    test.add_argument('--expected-hash')
    args = parser.parse_args()
    try:
        data = configure()
        if args.action == 'init':
            print(json.dumps(init(data), indent=2))
        elif args.action == 'doctor':
            print(json.dumps(doctor(data, args.refresh), indent=2))
        elif args.action == 'snapshot':
            print(json.dumps(snapshot(data, args.problem, args.solution)))
        else:
            def fingerprint():
                root = problem_path(data, args.problem)
                paths = [p for base in (root, APP / 'runtime') for p in base.iterdir() if p.is_file()]
                return [(str(p), p.stat().st_mtime_ns, p.stat().st_size) for p in sorted(paths)]
            while True:
                before = fingerprint() if args.watch else None
                report = run(data, args)
                if not args.watch:
                    return 0 if report['status'] == 'passed' else 1
                emit(args, {'type': 'message', 'text': 'Watching for saved changes… Ctrl-C to stop.'})
                while fingerprint() == before:
                    time.sleep(0.2)
                time.sleep(0.2)  # Coalesce rapid saves; edits during a run queue the next run.
    except KeyboardInterrupt:
        return 130
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        emit(args, {'type': 'error', 'error': str(exc)}) if getattr(args, 'json_lines', False) else print(f'Error: {exc}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
