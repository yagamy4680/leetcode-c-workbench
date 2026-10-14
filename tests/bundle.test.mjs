import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateProblemBundle } from '../server/problem-bundle.mjs';
const example = () => JSON.parse(fs.readFileSync('bundles/problem-94.json', 'utf8'));

test('every shipped example exports an import-compatible bundle', () => {
  for (const id of fs.readdirSync('examples').filter(id => /^\d+$/.test(id))) {
    const bundle = JSON.parse(execFileSync('python3', ['scripts/export-bundle.py', `examples/${id}`], { encoding: 'utf8' }));
    assert.deepEqual(validateProblemBundle(bundle, { artifact: true }), [], id);
  }
});
test('schema and semantic checks reject unsafe files, missing references and duplicate IDs', () => {
  for (const mutate of [
    b => { b.files['../secret.c'] = 'bad'; },
    b => { b.manifest.sources.push('missing.c'); },
    b => { b.manifest.sources.push('solution-master.c'); },
    b => { b.tests.push(b.tests[0]); },
    b => { b.tests[0].compare = ''; },
    b => { b.tests[0].timeoutMs = 60001; },
    b => { b.manifest.id = 0; },
  ]) { const bundle = example(); mutate(bundle); assert.ok(validateProblemBundle(bundle).length); }
});
test('size checks count UTF-8 bytes and the automatically prepended template', () => {
  const bundle = example(); bundle.files['extra.c'] = '漢'.repeat(350000);
  assert.ok(validateProblemBundle(bundle).some(error => error.path === '/files/extra.c'));
  delete bundle.files['extra.c']; bundle.files['solution-master.c'] = 'x'.repeat(1024 * 1024);
  assert.ok(validateProblemBundle(bundle).some(error => /preamble/.test(error.message)));
  assert.ok(validateProblemBundle(example(), { rawBytes: 12 * 1024 * 1024 + 1 }).some(error => /12 MiB/.test(error.message)));
});
test('local helpers are valid and overwrite consent stays out of portable artifacts', () => {
  const bundle = example(); bundle.files['wb_custom.c'] = '/* custom */'; bundle.files['wb_custom.h'] = '/* custom */';
  bundle.manifest.sources.push('wb_custom.c'); bundle.manifest.headers.push('wb_custom.h');
  assert.deepEqual(validateProblemBundle(bundle), []);
  bundle.overwrite = true; bundle.expectedHash = 'a'.repeat(64);
  assert.deepEqual(validateProblemBundle(bundle), []);
  assert.equal(validateProblemBundle(bundle, { artifact: true }).length, 2);
});
test('CLI validates stdin offline, returns structured errors and distinct exit codes', () => {
  const run = input => spawnSync(process.execPath, ['scripts/validate-problem.mjs', '--json', '-'], { input, encoding: 'utf8', env: { ...process.env, WB_DATA_DIR: process.cwd() } });
  const valid = run(JSON.stringify(example())); assert.equal(valid.status, 0); assert.equal(JSON.parse(valid.stdout).valid, true);
  const invalid = run('{}'); assert.equal(invalid.status, 1); assert.ok(JSON.parse(invalid.stdout).errors.length);
  assert.equal(run('{broken').status, 1);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-bundle-'));
  try { const missing = spawnSync(process.execPath, ['scripts/validate-problem.mjs', path.join(temp, 'missing.json')]); assert.equal(missing.status, 2); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Similar Questions validates canonical links, optional IDs and duplicate slugs',()=>{
  const bundle=example();assert.ok(bundle.manifest.similarQuestions.length);
  assert.deepEqual(validateProblemBundle(bundle),[]);
  const first=bundle.manifest.similarQuestions[0];
  first.url='https://leetcode.com/problems/wrong-slug/';assert.ok(validateProblemBundle(bundle).length);
  first.url=`https://leetcode.com/problems/${first.slug}/`;
  delete first.id;assert.deepEqual(validateProblemBundle(bundle),[]);
  bundle.manifest.similarQuestions.push({...first});assert.ok(validateProblemBundle(bundle).some(error=>/duplicate/.test(error.message)));
});
