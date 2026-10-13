import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve('.');
const serverURL = pathToFileURL(path.join(root, 'server/index.mjs')).href;
const configURL = pathToFileURL(path.join(root, 'server/config.mjs')).href;
const fixtureEnv = data => {
  const env = { ...process.env, WB_DATA_DIR: data, WB_USER: 'startup-fixture', WB_PASSWORD: 'fixture-only' };
  delete env.DATABASE_URL;
  return env;
};
function runNode(code, env, cwd) {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd, env, encoding: 'utf8', timeout: 30000 });
  return JSON.parse(output.split('RESULT_JSON:').at(-1).trim());
}
const start = `
  const { createApp } = await import(${JSON.stringify(serverURL)});
  const { dataDir, databaseFile, databaseUrl } = await import(${JSON.stringify(configURL)});
  const app = await createApp();
  const count = await app.db.problem.count();
  console.log('RESULT_JSON:' + JSON.stringify({ count, dataDir, databaseFile, databaseUrl }));
  await app.close();
`;
function fixture(action) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-startup-'));
  try { return action(temp); } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

test('fresh startup initializes schema and examples before accepting queries', () => fixture(temp => {
  const data = path.join(temp, 'workspace with spaces');
  const result = runNode(start, fixtureEnv(data), temp);
  assert.equal(result.count, 3);
  assert.equal(result.databaseFile, path.join(data, 'workbench.db'));
  assert.ok(fs.existsSync(result.databaseFile));
}));

test('an existing empty database is initialized without overwriting solutions', () => fixture(temp => {
  const data = path.join(temp, 'workspace');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'workbench.db'), '');
  const problem = path.join(data, 'problems', '1480');
  fs.mkdirSync(path.dirname(problem));
  fs.cpSync(path.join(root, 'examples', '1480'), problem, { recursive: true });
  const solution = path.join(problem, 'solution-master.c');
  fs.writeFileSync(solution, '/* existing personal solution */');
  assert.equal(runNode(start, fixtureEnv(data), temp).count, 3);
  assert.equal(fs.readFileSync(solution, 'utf8'), '/* existing personal solution */');
}));

test('setup and runtime use the same custom database; restarts preserve records', () => fixture(temp => {
  // Run the actual setup script in an isolated checkout so no real .env changes.
  const checkout = path.join(temp, 'checkout');
  fs.mkdirSync(checkout);
  for (const name of ['scripts/setup.mjs', 'server/config.mjs', 'server/database.mjs', 'runner/workbench.py', 'prisma/schema.prisma']) {
    const dest = path.join(checkout, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, name), dest);
  }
  fs.cpSync(path.join(root, 'examples'), path.join(checkout, 'examples'), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(checkout, 'node_modules'), 'dir');
  const data = path.join(temp, 'workspace');
  const database = path.join(temp, 'custom database', 'metadata.db');
  const env = { ...fixtureEnv(data), DATABASE_URL: `file:${database}` };
  execFileSync(process.execPath, [path.join(checkout, 'scripts/setup.mjs')], { cwd: temp, env, timeout: 30000 });
  assert.ok(fs.existsSync(database));
  assert.equal(fs.existsSync(path.join(data, 'workbench.db')), false);
  const result = runNode(`
    const { createApp } = await import(${JSON.stringify(serverURL)});
    let app = await createApp();
    await app.db.submission.create({ data: { id: 'fixture', problemId: 1480, solution: 'master', sourceHash: 'fixture', commitSha: 'fixture', memo: 'preserve this memo' } });
    await app.close();
    app = await createApp();
    const record = await app.db.submission.findUnique({ where: { id: 'fixture' } });
    console.log('RESULT_JSON:' + JSON.stringify({ memo: record.memo, count: await app.db.problem.count() }));
    await app.close();
  `, env, temp);
  assert.equal(result.memo, 'preserve this memo');
  assert.equal(result.count, 3);
}));

test('an unrelated nonempty database is left intact and startup fails clearly', () => fixture(temp => {
  const data = path.join(temp, 'workspace');
  fs.mkdirSync(data);
  const file = path.join(data, 'workbench.db');
  execFileSync('python3', ['-c', "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('CREATE TABLE Sentinel (value TEXT)'); db.execute(\"INSERT INTO Sentinel VALUES ('keep')\"); db.commit()", file]);
  const result = spawnSync(process.execPath, [path.join(root, 'server/index.mjs')], { cwd: temp, env: fixtureEnv(data), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing tables: Problem, Solution, Run, Submission/);
  assert.match(result.stderr, /npm run setup/);
  assert.ok(result.stderr.includes(file));
  assert.doesNotMatch(result.stdout, /listening at/);
  assert.equal(execFileSync('python3', ['-c', "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); print(db.execute('SELECT value FROM Sentinel').fetchone()[0])", file], { encoding: 'utf8' }).trim(), 'keep');
}));

test('relative workspace paths match between web and CLI from another cwd', () => fixture(temp => {
  const expected = path.join(temp, 'workspace');
  const env = fixtureEnv(path.relative(root, expected));
  const result = runNode(`const c=await import(${JSON.stringify(configURL)}); console.log('RESULT_JSON:'+JSON.stringify({dataDir:c.dataDir}));`, env, temp);
  assert.equal(result.dataDir, expected);
  const cli = JSON.parse(execFileSync('python3', [path.join(root, 'runner/workbench.py'), 'init'], { cwd: temp, env, encoding: 'utf8' }));
  assert.equal(cli.dataDir, expected);
}));

test('relative SQLite URLs resolve consistently against the schema directory', () => fixture(temp => {
  const database = path.join(temp, 'metadata with spaces.db');
  const env = { ...fixtureEnv(path.join(temp, 'workspace')), DATABASE_URL: `file:${path.relative(path.join(root, 'prisma'), database)}` };
  const result = runNode(start, env, temp);
  assert.equal(result.databaseFile, database);
  assert.equal(result.databaseUrl, `file:${database}`);
  assert.equal(result.count, 3);
}));
