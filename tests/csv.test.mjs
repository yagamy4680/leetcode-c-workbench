import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { problemCsv } from '../server/problem-csv.mjs';

function parseCsv(text) {
  return JSON.parse(execFileSync('python3', ['-c', 'import csv,io,json,sys;print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read().removeprefix("\\ufeff"))))))'], { input: text, encoding: 'utf8' }));
}

test('CSV round-trips Unicode, commas, quotes and multiline imported metadata', () => {
  const url = 'https://leetcode.com/problems/example/?note="a,b"\r\n測試';
  const csv = problemCsv([{ id: 94, url, difficulty: 'Easy', runs: [], accepted: false }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.deepEqual(parseCsv(csv), [
    ['problem-id', 'problem-url', 'difficulty', 'passed', 'accepted'],
    ['94', url, 'Easy', '', 'false']
  ]);
  assert.ok(csv.endsWith('\r\n'));
});

test('CSV neutralizes spreadsheet formulas rather than relying on quoting', () => {
  for (const value of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', ' \t=1+1', '\tformula', '\rformula', '\nformula']) {
    const rows = parseCsv(problemCsv([{ id: 1, url: value, difficulty: value, runs: [{ status: 'passed' }], accepted: true }]));
    assert.deepEqual(rows[1], ['1', `'${value}`, `'${value}`, 'true', 'true']);
  }
});

test('an empty workspace still exports the five-column header', () => {
  assert.deepEqual(parseCsv(problemCsv([])), [['problem-id', 'problem-url', 'difficulty', 'passed', 'accepted']]);
});
