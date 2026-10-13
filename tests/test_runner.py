import importlib.util
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import shlex
import tempfile
import unittest
from unittest.mock import patch

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
    if(!p) return; visit(p->left,last,found,best);
    if(*found && p->val-*last<*best) *best=p->val-*last;
    *last=p->val; *found=1; visit(p->right,last,found,best);
}
int minDiffInBST(struct TreeNode *root) { int last=0,found=0,best=INT_MAX; visit(root,&last,&found,&best); return best; }'''
NARY = '''static int count(struct Node *p) { if(!p) return 0; int n=1; for(int i=0;i<p->numChildren;i++) n+=count(p->children[i]); return n; }
static void walk(struct Node *p,int *out,int *at) { if(!p)return; out[(*at)++]=p->val; for(int i=0;i<p->numChildren;i++) walk(p->children[i],out,at); }
int* preorder(struct Node *root,int *size) { *size=count(root); int *out=malloc((size_t)(*size)*sizeof(int)); int at=0; walk(root,out,&at); return out; }'''


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

    def test_three_problem_encodings_and_solution_variants(self):
        for problem, code in ((1480, ARRAY), (783, BST), (589, NARY)):
            with self.subTest(problem=problem):
                self.code(problem, code, 'reference')
                result, report = self.run_problem(problem, 'reference')
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertEqual(report['passed'], report['total'])
                self.assertNotEqual((self.data/'problems'/str(problem)/'solution-master.c').read_text(), code)

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
        self.code(1480, ARRAY)
        _, report = self.run_problem(1480,'master','--case','single')
        self.assertEqual(report['status'],'passed')
        folder=self.data/'runs'/report['id']/'cases/single'
        self.assertIn('processed', (folder/'run.stdout.log').read_text())
        self.assertEqual(wb.read_json(folder/'actual.json'), [5])

    def test_input_alias_is_not_double_freed(self):
        self.code(1480, 'int* runningSum(int* a,int n,int* s) { for(int i=1;i<n;i++)a[i]+=a[i-1]; *s=n; return a; }')
        _, report = self.run_problem()
        self.assertEqual(report['status'], 'passed')

    def test_compiler_diagnostics(self):
        self.code(1480, 'int* runningSum( broken syntax')
        result, report = self.run_problem()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report['status'], 'compile_error')
        errors=(self.data/'runs'/report['id']/'compile.stderr.log').read_text()
        self.assertIn('solution-master.c:', errors)
        self.assertIn('error:', errors)

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

    def test_timeout_does_not_block_other_cases(self):
        self.code(1480, 'int* runningSum(int* a,int n,int* s) { if(a[0]==1)for(;;){} *s=n; return a; }')
        wb.write_json(self.data/'problems/1480/tests.json', [
            {'id':'hang','input':{'nums':[1]},'expected':[1],'timeoutMs':50},
            {'id':'next','input':{'nums':[7]},'expected':[7]}])
        _, report = self.run_problem()
        self.assertEqual([c['status'] for c in report['cases']], ['timeout','passed'])

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
