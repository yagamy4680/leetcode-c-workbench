import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readProblemZip } from '../server/problem-zip.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (script, ...args) => execFileSync(script.endsWith('.py') ? 'python3' : process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

test('packager produces a portable ZIP that the shared reader and CLI validate', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-zip-'));
  try {
    const directory = path.join(temporary, 'bundles'); fs.mkdirSync(directory);
    fs.copyFileSync(path.join(root, 'bundles/problem-94.json'), path.join(directory, 'problem-94.json'));
    const second = JSON.parse(run('export-bundle.py', path.join(root, 'examples/589')));
    fs.writeFileSync(path.join(directory, 'problem-589.json'), JSON.stringify(second));
    fs.writeFileSync(path.join(directory, '_collection.json'), JSON.stringify({ included: [94, 589], unavailable: [{ slug: 'restricted', reason: 'Official C starter unavailable' }], complete: false }));
    const output = path.join(temporary, 'collection.zip');
    run('package-problems.py', directory, output);
    const { entries, collectionReport } = await readProblemZip(fs.readFileSync(output));
    assert.deepEqual(entries.map(entry => entry.bundle.manifest.id).sort((a,b) => a-b), [94, 589]);
    assert.equal(collectionReport.complete, false);
    const result = JSON.parse(run('validate-problem-zip.mjs', '--json', output));
    assert.equal(result.valid, true); assert.equal(result.count, 2); assert.equal(result.unavailable.length, 1);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('failed archive validation preserves the previous ZIP and removes temporary files', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-zip-'));
  try {
    const directory = path.join(temporary, 'bundles'); fs.mkdirSync(directory);
    // The JSON is valid independently, but its ZIP filename claims the wrong ID.
    fs.copyFileSync(path.join(root, 'bundles/problem-94.json'), path.join(directory, 'problem-95.json'));
    const output = path.join(temporary, 'collection.zip'); fs.writeFileSync(output, 'previous archive');
    assert.throws(() => run('package-problems.py', directory, output));
    assert.equal(fs.readFileSync(output, 'utf8'), 'previous archive');
    assert.deepEqual(fs.readdirSync(temporary).sort(), ['bundles', 'collection.zip']);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
