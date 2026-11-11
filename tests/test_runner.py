import importlib.util
import argparse
import contextlib
import errno
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import shlex
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('workbench', ROOT / 'runner/workbench.py')
wb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wb)

ARRAY = '''int* runningSum(int* nums, int n, int* size) {
    int *out=malloc((size_t)n*sizeof(int)); int sum=0;
    for(int i=0;i<n;i++) { sum+=nums[i]; out[i]=sum; }
    *size=n; printf("processed %d elements\\n",n); return out;
}'''
BST = '''static void visit(struct TreeNode *p,int *last,int *found,int *best) {
    if(!p) return;
    visit(p->left,last,found,best);
    if(*found && p->val-*last<*best) *best=p->val-*last;
    *last=p->val; *found=1; visit(p->right,last,found,best);
}
int minDiffInBST(struct TreeNode *root) { int last=0,found=0,best=INT_MAX; visit(root,&last,&found,&best); return best; }'''
NARY = '''static int count(struct Node *p) { if(!p) return 0; int n=1; for(int i=0;i<p->numChildren;i++) n+=count(p->children[i]); return n; }
static void walk(struct Node *p,int *out,int *at) { if(!p)return; out[(*at)++]=p->val; for(int i=0;i<p->numChildren;i++) walk(p->children[i],out,at); }
int* preorder(struct Node *root,int *size) { *size=count(root); int *out=malloc((size_t)(*size)*sizeof(int)); int at=0; walk(root,out,&at); return out; }'''

INORDER = 'static void visit(struct TreeNode *p, int *out, int *at) {\n    if (!p) return;\n    visit(p->left, out, at); out[(*at)++] = p->val; visit(p->right, out, at);\n}\nint* inorderTraversal(struct TreeNode *root, int *size) {\n    int *out = malloc(100 * sizeof(int)); *size = 0;\n    visit(root, out, size); return out;\n}'

class ProcessOutputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='wb-output-')
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.events = []

    def execute(self, code, receive=None, timeout=3):
        receive = receive or self.events.append
        with patch.object(wb, 'emit', side_effect=lambda args, event: receive(event)):
            return wb.execute([sys.executable, '-u', '-c', code], self.folder, 'run', timeout,
                              os.environ.copy(), argparse.Namespace(json_lines=True), 'interleaved')

    def test_lines_stream_live_across_both_pipes_with_split_utf8_and_eof_tail(self):
        # Each acknowledgement proves forwarding happens before the child finishes.
        code = r'''
import os
from pathlib import Path
import time
def wait(number):
    while not Path('ack-' + str(number)).exists():
        time.sleep(0.001)
os.write(2, b'error first\n')
wait(1)
os.write(1, b'out part')
os.write(2, b'error while stdout incomplete\n')
wait(2)
os.write(1, b' rest\n\n')
wait(4)
os.write(1, b'\xe6')
os.write(2, b'utf8 split\n')
wait(5)
os.write(1, b'\xa8\xb9\n')
wait(6)
os.write(2, b'final tail')
'''
        def receive(event):
            self.events.append(event)
            (self.folder / f'ack-{len(self.events)}').touch()
        code, reason, _ = self.execute(code, receive)
        self.assertEqual((code, reason), (0, None))
        self.assertEqual([(e['stream'], e['text']) for e in self.events], [
            ('stderr', 'error first\n'), ('stderr', 'error while stdout incomplete\n'),
            ('stdout', 'out part rest\n'), ('stdout', '\n'),
            ('stderr', 'utf8 split\n'), ('stdout', '樹\n'), ('stderr', 'final tail')])
        for event in self.events:
            self.assertEqual(event['case'], 'interleaved')
            self.assertRegex(event['timestamp'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$')
        self.assertEqual((self.folder / 'run.stdout.log').read_bytes(), 'out part rest\n\n樹\n'.encode())
        self.assertEqual((self.folder / 'run.stderr.log').read_bytes(), b'error first\nerror while stdout incomplete\nutf8 split\nfinal tail')

    def test_output_limit_bounds_logs_and_a_line_without_a_newline(self):
        with patch.object(wb, 'MAX_LOG', 4096):
            _, reason, _ = self.execute("import os\nwhile True: os.write(1, b'x' * 8192)")
        self.assertEqual(reason, 'output_limit')
        self.assertEqual((self.folder / 'run.stdout.log').stat().st_size, 4096)
        self.assertEqual((self.folder / 'run.stderr.log').stat().st_size, 0)
        self.assertEqual([event['text'] for event in self.events], ['x' * 4096])

    def test_timeout_flushes_partial_line_and_still_waits_after_both_pipes_close(self):
        _, reason, _ = self.execute("import os, time\nos.write(2, b'waiting')\ntime.sleep(30)", timeout=0.2)
        self.assertEqual(reason, 'timeout')
        self.assertEqual([event['text'] for event in self.events], ['waiting'])
        _, reason, _ = self.execute('import os, time\nos.close(1)\nos.close(2)\ntime.sleep(30)', timeout=0.2)
        self.assertEqual(reason, 'timeout')

    def test_completed_parent_cleans_up_descendants_holding_pipes(self):
        code, reason, duration = self.execute("import subprocess, sys\nsubprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])")
        self.assertEqual((code, reason), (0, None))
        self.assertLess(duration, 2000)

    def test_cleanup_eperm_after_exit_preserves_code_and_diagnostics(self):
        with patch.object(wb.os, 'killpg', side_effect=PermissionError(errno.EPERM, 'Operation not permitted')):
            code, reason, _ = self.execute("import os\nos.write(2, b'runtime error: null pointer\\nfinal diagnostic')\nos._exit(1)")
        self.assertEqual((code, reason), (1, None))
        self.assertEqual([event['text'] for event in self.events],
                         ['runtime error: null pointer\n', 'final diagnostic'])
        self.assertEqual((self.folder / 'run.stderr.log').read_bytes(),
                         b'runtime error: null pointer\nfinal diagnostic')

    def test_cleanup_eperm_does_not_hide_permission_failure_for_a_live_process(self):
        proc = Mock(pid=12345)
        proc.poll.return_value = None
        with patch.object(wb.os, 'killpg', side_effect=PermissionError(errno.EPERM, 'Operation not permitted')):
            with self.assertRaises(PermissionError):
                wb.kill_process_group(proc)
        proc.poll.assert_called_once_with()

    def test_console_timestamps_stream_colors_and_plain_json_events(self):
        args = argparse.Namespace(json_lines=False)
        for stream, color in (('stdout', '90'), ('stderr', '35')):
            for text in ('hello\n', 'tail'):
                event = {'type': 'log', 'stream': stream, 'case': 'single',
                         'timestamp': '2026-11-11T09:10:11.123+08:00', 'text': text}
                modes = (({'TERM': 'xterm-256color'}, True, True), ({}, False, False),
                         ({'FORCE_COLOR': '1'}, False, True),
                         ({'FORCE_COLOR': '1', 'NO_COLOR': ''}, True, False),
                         ({'FORCE_COLOR': '0'}, True, False))
                for env, tty, colored in modes:
                    with self.subTest(stream=stream, text=text, env=env):
                        output = io.StringIO()
                        with patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(output), patch.object(output, 'isatty', return_value=tty):
                            wb.emit(args, event)
                        line = f'09:10:11.123 [{stream}] ' + text.rstrip('\n')
                        self.assertEqual(output.getvalue(), (f'\033[{color}m{line}\033[0m' if colored else line) + '\n')
                output = io.StringIO()
                with patch.dict(os.environ, {'FORCE_COLOR': '1'}, clear=True), contextlib.redirect_stdout(output):
                    wb.emit(argparse.Namespace(json_lines=True), event)
                self.assertEqual(json.loads(output.getvalue()), event)
                self.assertNotIn('\033', output.getvalue())


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='wb-test-')
        self.data = Path(self.tmp.name)
        wb.init(self.data)
        self.env = {**os.environ, 'WB_DATA_DIR': str(self.data)}

    def tearDown(self):
        self.tmp.cleanup()

    def code(self, problem, code, name='master'):
        (self.data / 'problems' / str(problem) / f'solution-{name}.c').write_text(code)

    def run_problem(self, problem=1480, variant='master', *options):
        result = subprocess.run(['python3', str(ROOT / 'runner/workbench.py'), 'run', str(problem), variant, '--json-lines', *options], env=self.env, capture_output=True, text=True, timeout=40)
        events = [json.loads(line) for line in result.stdout.splitlines()]
        done = next((e['run'] for e in events if e['type'] == 'done'), None)
        self.assertIsNotNone(done, result.stdout + result.stderr)
        return result, done

    def test_four_problem_encodings_and_solution_variants(self):
        for problem, code in ((1480, ARRAY), (783, BST), (589, NARY), (94, INORDER)):
            with self.subTest(problem=problem):
                self.code(problem, code, 'reference')
                result, report = self.run_problem(problem, 'reference')
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertEqual(report['passed'], report['total'])
                self.assertNotEqual((self.data/'problems'/str(problem)/'solution-master.c').read_text(), code)

    def test_debug_preamble_logs_only_in_debug_and_is_not_added_to_existing_files(self):
        file = self.data/'problems/1480/solution-master.c'
        preamble = (ROOT/'templates/solution-preamble.c').read_text()
        self.assertTrue(file.read_text().startswith(preamble))
        code = preamble + ARRAY.replace('int *out=malloc', 'DBG("hello\\n"); DBG("n=%d\\n", n); int *out=malloc')
        self.code(1480, code)
        _, debug = self.run_problem(1480, 'master', '--case', 'single')
        self.assertEqual(debug['status'], 'passed')
        log = (self.data/'runs'/debug['id']/'cases/single/run.stderr.log').read_text()
        self.assertIn('hello', log)
        self.assertIn('n=1', log)
        _, perf = self.run_problem(1480, 'master', '--case', 'single', '--mode', 'perf')
        self.assertEqual(perf['status'], 'passed')
        self.assertEqual((self.data/'runs'/perf['id']/'cases/single/run.stderr.log').read_text(), '')
        self.code(1480, ARRAY)
        wb.init(self.data)
        self.assertEqual(file.read_text(), ARRAY)

    def test_large_and_deep_nary_trees(self):
        self.code(589, NARY)
        star = [1, None] + list(range(1,10000))
        chain = [1]
        for i in range(2,1001): chain.extend([None,i])
        wb.write_json(self.data/'problems/589/tests.json', [
            {'id':'wide','input':{'root':star},'expected':[1]+list(range(1,10000))},
            {'id':'deep','input':{'root':chain},'expected':list(range(1,1001))}])
        _, report = self.run_problem(589)
        self.assertEqual(report['status'],'passed')

    def test_linked_list_registry_survives_reversal(self):
        root = self.data/'problems/1480'
        (root/'solution.h').write_text('#include <stdlib.h>\n#include "wb_list_types.h"\nstruct ListNode* reverseList(struct ListNode* head);\n')
        (root/'main.c').write_text('''#include "wb_list.h"
int main(int argc,char**argv){if(argc!=3)wb_fail("paths");WbJson j=wb_load(argv[1]);WbList list=wb_list(&j,wb_field(&j,"head"));
struct ListNode *p=reverseList(list.head);int *out=wb_alloc((size_t)list.count,sizeof(int));
for(int i=0;i<list.count;i++){if(!p)wb_fail("short result");out[i]=p->val;p=p->next;}
wb_result_array(argv[2],out,list.count);free(out);wb_list_free(&list);wb_json_free(&j);return 0;}''')
        self.code(1480,'struct ListNode* reverseList(struct ListNode* p){struct ListNode *prev=NULL;while(p){struct ListNode*n=p->next;p->next=prev;prev=p;p=n;}return prev;}')
        wb.write_json(root/'tests.json',[{'id':'reverse','input':{'head':[1,2,3]},'expected':[3,2,1]},{'id':'empty','input':{'head':[]},'expected':[]}])
        _,report=self.run_problem()
        self.assertEqual(report['status'],'passed')

    def test_cache_and_immutable_run_inputs(self):
        self.code(1480, ARRAY)
        _, first = self.run_problem()
        self.assertFalse(first['cached'])
        _, second = self.run_problem()
        self.assertTrue(second['cached'])
        tests_file = self.data/'problems/1480/tests.json'
        cases = wb.read_json(tests_file)
        cases.append({'id':'new','input':{'nums':[0,2]},'expected':[0,2]})
        wb.write_json(tests_file,cases)
        _, third = self.run_problem()
        self.assertTrue(third['cached'])
        self.assertNotEqual(second['contextHash'], third['contextHash'])
        self.code(1480, ARRAY+'\n/* changed */')
        _, fourth = self.run_problem()
        self.assertFalse(fourth['cached'])
        captured = self.data/'runs'/first['id']/'source/problem/solution-master.c'
        self.assertEqual(captured.read_text(), ARRAY)
        self.assertEqual(len(wb.read_json(self.data/'runs'/first['id']/'source/problem/tests.json')), 5)

    def test_stdout_is_debug_output_not_answer(self):
        self.code(1480, ARRAY.replace('printf(', 'fprintf(stderr, "stderr trace\\n"); printf('))
        result, report = self.run_problem(1480,'master','--case','single')
        self.assertEqual(report['status'],'passed')
        folder=self.data/'runs'/report['id']/'cases/single'
        self.assertEqual((folder/'run.stdout.log').read_text(), 'processed 1 elements\n')
        self.assertEqual((folder/'run.stderr.log').read_text(), 'stderr trace\n')
        self.assertEqual(wb.read_json(folder/'actual.json'), [5])
        logs = [json.loads(line) for line in result.stdout.splitlines() if json.loads(line)['type'] == 'log']
        self.assertCountEqual([(event['stream'], event['text']) for event in logs],
                              [('stderr', 'stderr trace\n'), ('stdout', 'processed 1 elements\n')])
        self.assertTrue(all('timestamp' in event for event in logs))
        console_env = {key: value for key, value in self.env.items() if key != 'NO_COLOR'}
        console = subprocess.run([str(ROOT/'run-test.sh'), '1480', '--case', 'single', '--mode', 'perf'],
                                 env={**console_env, 'FORCE_COLOR': '1'}, capture_output=True, text=True, timeout=40)
        self.assertEqual(console.returncode, 0, console.stdout + console.stderr)
        self.assertRegex(console.stdout, r'\x1b\[90m\d\d:\d\d:\d\d\.\d{3} \[stdout\] processed 1 elements\x1b\[0m\n')
        self.assertRegex(console.stdout, r'\x1b\[35m\d\d:\d\d:\d\d\.\d{3} \[stderr\] stderr trace\x1b\[0m\n')
        self.assertEqual(console.stdout.count('[\033[32mpassed\033[0m] single.'), 2)

    def test_input_alias_is_not_double_freed(self):
        self.code(1480, 'int* runningSum(int* a,int n,int* s) { for(int i=1;i<n;i++)a[i]+=a[i-1]; *s=n; return a; }')
        _, report = self.run_problem()
        self.assertEqual(report['status'], 'passed')

    def test_cli_summary_survives_large_output_and_failed_case_command_is_runnable(self):
        self.code(1480, ARRAY.replace('printf(', 'for (int i=0; i<2000; ++i) puts("verbose trace"); printf('), 'queue-opt')
        wb.write_json(self.data/'problems/1480/tests.json', [
            {'id': 'example1', 'input': {'nums': [1]}, 'expected': [1]},
            {'id': 'bad-output', 'input': {'nums': [2]}, 'expected': [3]}])
        command = [str(ROOT/'run-test.sh'), '1480', 'queue-opt', '--mode', 'perf']
        env = {**self.env, 'NO_COLOR': '1'}
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=40)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertGreater(result.stdout.count('verbose trace'), 3000)
        summary = result.stdout.split('\nCase summary:\n', 1)[1]
        run_id = result.stdout.splitlines()[-1].rsplit(' ', 1)[1]
        report = wb.read_json(self.data/'runs'/run_id/'result.json')
        for case in report['cases']:
            if case['status'] == 'passed':
                line = f'[passed] {case["id"]}. {case["durationMs"]}ms'
            else:
                line = f'[failed] {case["id"]}. {case["durationMs"]}ms ({case["errorSummary"]})'
            self.assertIn('  ' + line + '\n', summary)
            self.assertEqual(result.stdout.count(line + '\n'), 2)
        self.assertEqual(report['cases'][1]['errorSummary'], 'Output does not match expected at $[0]')
        self.assertNotIn('verbose trace', summary)
        self.assertNotIn('input:', summary)
        self.assertNotIn('expected:', summary)
        self.assertNotIn('actual:', summary)
        self.assertTrue(summary.splitlines()[-1].startswith('failed: 1/2'))
        rerun = summary.split('Rerun failed cases:\n', 1)[1].splitlines()[0].strip()
        self.assertEqual(shlex.split(rerun), ['./run-test.sh', '1480', 'queue-opt', '--case', 'bad-output', '--mode', 'perf'])
        color_env = {key: value for key, value in env.items() if key != 'NO_COLOR'}
        replay = subprocess.run(shlex.split(rerun), cwd=ROOT, env={**color_env, 'FORCE_COLOR': '1'}, capture_output=True, text=True, timeout=40)
        self.assertEqual(replay.returncode, 1, replay.stderr)
        self.assertEqual(replay.stdout.count('[\033[31mfailed\033[0m] bad-output.'), 2)
        replay_summary = re.sub(r'\x1b\[[0-9;]*m', '', replay.stdout).split('\nCase summary:\n', 1)[1]
        self.assertRegex(replay_summary, r'\[failed\] bad-output\. \d+ms \(Output does not match expected at \$\[0\]\)')
        self.assertNotIn('example1', replay_summary)
        self.assertTrue(replay_summary.splitlines()[-1].startswith('failed: 0/1'))
        structured = subprocess.run([*command, '--json-lines'], cwd=ROOT, env=env, capture_output=True, text=True, timeout=40)
        events = [json.loads(line) for line in structured.stdout.splitlines()]
        self.assertEqual(events[-1]['type'], 'done')
        self.assertEqual([case['status'] for case in events[-1]['run']['cases']], ['passed', 'wrong_answer'])
        self.assertEqual(events[-1]['run']['cases'][1]['errorSummary'], 'Output does not match expected at $[0]')
        self.assertNotIn('Case summary:', structured.stdout)

    def test_failure_summaries_explain_crashes_and_invalid_return_values(self):
        scenarios = [
            ('crash', '#include <signal.h>\n' + ARRAY.replace('int *out=malloc', 'raise(SIGSEGV); int *out=malloc'),
             'runtime_error', 'Program crashed: SIGSEGV'),
            ('invalid-size', ARRAY.replace('*size=n;', '*size=-1;'),
             'driver_error', 'Driver error: invalid returnSize or NULL result'),
        ]
        for variant, source, status, summary in scenarios:
            with self.subTest(variant=variant):
                self.code(1480, source, variant)
                result, report = self.run_problem(1480, variant, '--case', 'single', '--mode', 'perf')
                self.assertEqual(result.returncode, 1)
                case = report['cases'][0]
                self.assertEqual(case['status'], status)
                self.assertEqual(case['errorSummary'], summary)
                if variant == 'crash':
                    self.assertEqual(case['exitCode'], -signal.SIGSEGV)

    def test_compiler_diagnostics(self):
        self.code(1480, 'int* runningSum( broken syntax')
        result, report = self.run_problem()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report['status'], 'compile_error')
        errors=(self.data/'runs'/report['id']/'compile.stderr.log').read_text()
        self.assertIn('solution-master.c:', errors)
        self.assertIn('error:', errors)

    def test_cli_blocks_all_warnings_before_cases_in_both_modes(self):
        pointer_comparison = '''int* inorderTraversal(struct TreeNode* root, int* returnSize) {
    *returnSize = 0;
    if (root >= 10) printf("must not execute\\n");
    return NULL;
}'''
        unused_variable = ARRAY.replace('int sum=0;', 'int sum=0; int unused;')
        for mode in ('debug', 'perf'):
            for problem, source in ((94, pointer_comparison), (1480, unused_variable)):
                with self.subTest(mode=mode, problem=problem):
                    self.code(problem, source, 'warning')
                    execution = subprocess.run([str(ROOT/'run-test.sh'), str(problem), 'warning', '--mode', mode, '--json-lines'], env=self.env, capture_output=True, text=True, timeout=40)
                    events = [json.loads(line) for line in execution.stdout.splitlines()]
                    report = next(event['run'] for event in events if event['type'] == 'done')
                    self.assertEqual(execution.returncode, 1)
                    self.assertEqual(report['status'], 'compile_error')
                    self.assertIn('-Werror', report['command'])
                    self.assertEqual(report['cases'], [])
                    self.assertFalse(any(event['type'] == 'case' for event in events))
                    self.assertFalse((self.data/'runs'/report['id']/'cases').exists())
                    diagnostics = (self.data/'runs'/report['id']/'compile.stderr.log').read_text()
                    self.assertIn('error:', diagnostics)
                    self.assertIn('solution-warning.c:', diagnostics)
            self.code(1480, ARRAY, 'warning')
            execution, report = self.run_problem(1480, 'warning', '--mode', mode)
            self.assertEqual(execution.returncode, 0)
            self.assertEqual(report['status'], 'passed')
            self.assertFalse(report['cached'])

    def test_full_command_round_trips_paths_with_spaces_and_json_has_no_ansi(self):
        self.data = self.data/'workspace with spaces'
        wb.init(self.data)
        self.env.update(WB_DATA_DIR=str(self.data), FORCE_COLOR='1')
        self.code(1480, ARRAY)
        result, report = self.run_problem(1480,'master','--case','single')
        events = [json.loads(line) for line in result.stdout.splitlines()]
        command = next(event for event in events if event['type'] == 'command')
        self.assertEqual(shlex.split(command['text']), report['command'])
        self.assertEqual(command['argv'], report['command'])
        self.assertIn('-fsanitize=address,undefined', command['argv'])
        self.assertTrue(any('workspace with spaces' in arg for arg in command['argv']))
        self.assertNotIn('\033', result.stdout)
        cached, second = self.run_problem(1480,'master','--case','single')
        self.assertTrue(second['cached'])
        self.assertFalse(any(json.loads(line)['type'] == 'command' for line in cached.stdout.splitlines()))

    def test_command_color_modes_preserve_the_entire_displayed_command(self):
        command = {'type':'command','text':"clang -I '/path with spaces' main.c -o program"}
        args = argparse.Namespace(json_lines=False)
        for env, tty, colored in (({'TERM':'xterm-256color'},True,True), ({},False,False), ({'FORCE_COLOR':'1'},False,True), ({'FORCE_COLOR':'1','NO_COLOR':''},True,False), ({'FORCE_COLOR':'0'},True,False)):
            with self.subTest(env=env):
                output = io.StringIO()
                with patch.dict(os.environ,env,clear=True), contextlib.redirect_stdout(output), patch.object(output,'isatty',return_value=tty):
                    wb.emit(args,command)
                expected = '$ '+command['text']
                self.assertEqual(output.getvalue(), ('\033[1;36m'+expected+'\033[0m\n') if colored else expected+'\n')

    def test_out_of_bounds_is_memory_error(self):
        self.code(1480, 'int* runningSum(int* a,int n,int* s) { int *p=malloc(sizeof(int)); p[n]=a[0]; *s=1; return p; }')
        _, report = self.run_problem(1480,'master','--case','example1')
        # UBSan object-size checking can trap this before ASan; either catches it.
        self.assertIn(report['cases'][0]['status'], ('memory_error','undefined_behavior'))

    def test_undefined_behavior_fails_test(self):
        self.code(1480, 'int* runningSum(int* a,int n,int* s) { volatile int x=INT_MAX; a[0]=x+1; *s=n; return a; }')
        _, report = self.run_problem(1480,'master','--case','single')
        self.assertEqual(report['cases'][0]['status'],'undefined_behavior')

    def test_null_nary_root_and_cleanup_eperm_keep_failure_report_and_next_case(self):
        self.code(589, '''int* preorder(struct Node* root, int* size) {
    int value = root->val;
    int *result = malloc(sizeof(int));
    if (!result) abort();
    result[0] = value; *size = 1; return result;
}''')
        wb.write_json(self.data/'problems/589/tests.json', [
            {'id': 'empty-root', 'input': {'root': []}, 'expected': []},
            {'id': 'next', 'input': {'root': [7]}, 'expected': [7]}])
        args = argparse.Namespace(problem=589, solution='master', case=None, mode='debug', json_lines=True)
        output = io.StringIO()
        with patch.object(wb.os, 'killpg', side_effect=PermissionError(errno.EPERM, 'Operation not permitted')), contextlib.redirect_stdout(output):
            report = wb.run(self.data, args)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual([case['status'] for case in report['cases']], ['undefined_behavior', 'passed'])
        folder = self.data/'runs'/report['id']
        self.assertEqual(wb.read_json(folder/'result.json'), report)
        self.assertIn('member access within null pointer', (folder/'cases/empty-root/run.stderr.log').read_text())
        self.assertIn('member access within null pointer', report['cases'][0]['errorSummary'])
        self.assertTrue(report['cases'][0]['errorSummary'].startswith('Undefined behavior:'))
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(events[-1]['type'], 'done')
        self.assertEqual(events[-1]['run']['passed'], 1)

    def test_timeout_does_not_block_other_cases(self):
        self.code(1480, 'int* runningSum(int* a,int n,int* s) { if(a[0]==1)for(;;){} *s=n; return a; }')
        wb.write_json(self.data/'problems/1480/tests.json', [
            {'id':'hang','input':{'nums':[1]},'expected':[1],'timeoutMs':50},
            {'id':'next','input':{'nums':[7]},'expected':[7]}])
        _, report = self.run_problem()
        self.assertEqual([c['status'] for c in report['cases']], ['timeout','passed'])
        self.assertEqual(report['cases'][0]['errorSummary'], 'Time limit exceeded')

    def test_bad_input_is_driver_error(self):
        self.code(783, BST)
        wb.write_json(self.data/'problems/783/tests.json',[{'id':'bad','input':{'root':[1,None,None,2]},'expected':0}])
        _, report=self.run_problem(783)
        self.assertEqual(report['cases'][0]['status'],'driver_error')

    def test_leak_check_if_runtime_allows(self):
        if not wb.doctor(self.data)['leakSanitizer']:
            self.skipTest('LeakSanitizer probe unavailable in this host environment.')
        self.code(1480, 'int* runningSum(int* a,int n,int* s) { char *p=malloc(31); *(volatile char*)p=1; *s=n; return a; }')
        _, report=self.run_problem(1480,'master','--case','single')
        self.assertEqual(report['cases'][0]['status'],'memory_leak')

    def test_snapshot_commit_preserves_exact_source_and_context(self):
        self.code(1480, ARRAY)
        _, report = self.run_problem()
        snap=wb.snapshot(self.data,1480,'master')
        self.assertEqual(snap['sourceHash'], report['sourceHash'])
        self.assertEqual(snap['contextHash'], report['contextHash'])
        self.code(1480, 'edited afterwards')
        code=subprocess.run(['git','-C',str(self.data/'snapshots'),'show',f'{snap["commitSha"]}:{snap["id"]}/submission.c'],capture_output=True,text=True,check=True).stdout
        self.assertEqual(code, ARRAY)

    def test_comparison_modes_and_input_validation(self):
        self.assertIsNone(wb.compare({'expected':[2,1],'compare':'unordered'},[1,2]))
        self.assertIsNotNone(wb.compare({'expected':[1,1],'compare':'unordered'},[1,2]))
        self.assertIsNone(wb.compare({'expected':0.3,'compare':'float'},0.1+0.2))
        self.assertIsNotNone(wb.compare({'expected':1},True))
        with self.assertRaises(ValueError): wb.valid_name('../secret')
        with self.assertRaises(ValueError): wb.validate_tests([{'id':'x','input':{},'expected':1},{'id':'x','input':{},'expected':2}])

if __name__ == '__main__': unittest.main()
