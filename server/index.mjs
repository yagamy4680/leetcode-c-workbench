import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appDir, dataDir, databaseFile, python, host, port, requireCredentials } from './config.mjs';
import { createDatabaseClient, ensureDatabase } from './database.mjs';
import { HttpError, hash, readJSON, name, problemDir, ownedFile, solutionFile, atomic, saveChecked, validateTests, importBundle } from './workspace.mjs';
import { createIndexer, syncProblem } from './indexer.mjs';

import { createSourceEvents } from './source-events.mjs';

export function auth(req, res, next) {
  const header = req.get('authorization') || '';
  const actual = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
  const expected = `${process.env.WB_USER}:${process.env.WB_PASSWORD}`;
  const a = crypto.createHash('sha256').update(actual).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!actual || !crypto.timingSafeEqual(a, b)) return res.status(401).set('WWW-Authenticate', 'Basic realm="LeetCode Workbench", charset="UTF-8"').json({ error: 'Authentication required.' });
  next();
}

function runCommand(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(appDir, 'runner/workbench.py'), ...args], { env: process.env });
    let output = '', errors = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errors += data; });
    child.once('error', reject);
    child.once('close', code => {
      if (code) return reject(new HttpError(400, errors.trim() || 'Runner failed.'));
      try { resolve(JSON.parse(output)); } catch { reject(new HttpError(500, 'Invalid runner response.')); }
    });
  });
}

export async function createApp(db = createDatabaseClient()) {
  requireCredentials();
  const sync = createIndexer(db);
  try {
    await ensureDatabase(db);
    await db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    await sync();
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
  const sourceEvents = createSourceEvents();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(auth);
  // A browser's cached Basic Auth must not authorize cross-origin writes.
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site writes are blocked.' });
      const origin = req.get('origin');
      if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origin mismatch.' });
    }
    next();
  });
  app.use(express.json({ limit: '12mb', strict: true }));
  app.get('/vendor/bootstrap.css', (req, res) => res.sendFile(path.join(appDir, 'node_modules/bootstrap/dist/css/bootstrap.min.css')));
  app.get('/vendor/marked.js', (req, res) => res.sendFile(path.join(appDir, 'node_modules/marked/lib/marked.umd.js')));
  app.get('/vendor/purify.js', (req, res) => res.sendFile(path.join(appDir, 'node_modules/dompurify/dist/purify.min.js')));
  for (const language of ['core', 'clike', 'c']) {
    app.get(`/vendor/prism-${language}.js`, (req, res) => res.sendFile(path.join(appDir, `node_modules/prismjs/components/prism-${language}.min.js`)));
  }
  app.use(express.static(path.join(appDir, 'web')));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/doctor', async (req, res) => res.json(await runCommand(['doctor', ...(req.query.refresh === '1' ? ['--refresh'] : [])])));
  app.get('/api/problems', async (req, res) => {
    await sync();
    res.json(await db.problem.findMany({ orderBy: { id: 'asc' }, include: { solutions: true, runs: { orderBy: { startedAt: 'desc' }, take: 1 } } }));
  });
  app.post('/api/problems', async (req, res) => {
    const id = importBundle(req.body);
    await syncProblem(db, id);
    res.status(201).json({ id });
  });
  app.get('/api/problems/:id', async (req, res) => {
    await syncProblem(db, req.params.id);
    const problem = await db.problem.findUnique({ where: { id: Number(req.params.id) }, include: { solutions: true, runs: { orderBy: { startedAt: 'desc' }, take: 40 }, submissions: { orderBy: { createdAt: 'desc' }, take: 40 } } });
    const dir = problemDir(req.params.id);
    const testsFile = ownedFile(dir, 'tests.json');
    res.json({ ...problem, manifest: readJSON(ownedFile(dir, 'manifest.json')), description: fs.readFileSync(ownedFile(dir, 'description.md'), 'utf8'), tests: readJSON(testsFile), testsHash: hash(fs.readFileSync(testsFile)) });
  });
  app.get('/api/problems/:id/solutions/:variant', (req, res) => {
    const code = fs.readFileSync(solutionFile(req.params.id, req.params.variant), 'utf8');
    res.set('Cache-Control', 'no-store').json({ code, hash: hash(code) });
  });
  app.get('/api/problems/:id/solutions/:variant/events', (req, res) => sourceEvents.subscribe(req.params.id, name(req.params.variant), res));
  app.put('/api/problems/:id/solutions/:variant', async (req, res) => {
    if (typeof req.body.code !== 'string' || Buffer.byteLength(req.body.code) > 1024 * 1024) throw new HttpError(400, 'Provide code under 1 MiB.');
    const newHash = saveChecked(solutionFile(req.params.id, req.params.variant), req.body.code, req.body.expectedHash);
    await syncProblem(db, req.params.id);
    res.json({ hash: newHash });
  });
  app.post('/api/problems/:id/solutions', async (req, res) => {
    const variant = name(req.body.name);
    const original = solutionFile(req.params.id, req.body.from || 'master');
    const dest = path.join(problemDir(req.params.id), `solution-${variant}.c`);
    try { fs.copyFileSync(original, dest, fs.constants.COPYFILE_EXCL); } catch (error) { if (error.code === 'EEXIST') throw new HttpError(409, 'Solution already exists.'); throw error; }
    await syncProblem(db, req.params.id);
    res.status(201).json({ name: variant });
  });
  app.put('/api/problems/:id/tests', (req, res) => {
    validateTests(req.body.tests);
    const content = JSON.stringify(req.body.tests, null, 2) + '\n';
    const newHash = saveChecked(ownedFile(problemDir(req.params.id), 'tests.json'), content, req.body.expectedHash);
    res.json({ hash: newHash });
  });
  const active = new Set();
  app.post('/api/problems/:id/run', (req, res) => {
    const variant = name(req.body.solution || 'master');
    const file = solutionFile(req.params.id, variant);
    const mode = req.body.mode || 'debug';
    if (!['debug', 'perf'].includes(mode)) throw new HttpError(400, 'Invalid run mode.');
    if (req.body.case) name(req.body.case);
    if (req.body.sourceHash && req.body.sourceHash !== hash(fs.readFileSync(file))) throw new HttpError(409, 'Solution changed on disk. Reload before running.');
    const key = `${req.params.id}/${variant}`;
    if (active.has(key)) throw new HttpError(409, 'This solution is already running in the web app.');
    active.add(key);
    res.set('Content-Type', 'application/x-ndjson').set('Cache-Control', 'no-store');
    res.flushHeaders();
    const args = ['run', String(Number(req.params.id)), variant, '--mode', mode, '--json-lines'];
    if (req.body.case) args.push('--case', req.body.case);
    if (req.body.sourceHash) args.push('--expected-hash', req.body.sourceHash);
    const child = spawn(python, [path.join(appDir, 'runner/workbench.py'), ...args], { env: process.env });
    child.stdout.on('data', chunk => { if (!res.destroyed) res.write(chunk); });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk.toString().slice(0, 4000); });
    child.once('error', error => { if (!res.destroyed) res.end(JSON.stringify({ type: 'error', error: error.message }) + '\n'); active.delete(key); });
    child.once('close', async code => {
      try { await sync(); } catch (error) { console.error('Indexing:', error.message); }
      if (!res.destroyed) {
        if (code === 2 || errors) res.write(JSON.stringify({ type: 'error', error: errors || 'Runner could not start the test.' }) + '\n');
        res.end();
      }
      active.delete(key);
    });
  });
  app.get('/api/runs/:runId', (req, res) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.runId)) throw new HttpError(400, 'Invalid run ID.');
    res.json(readJSON(ownedFile(path.join(dataDir, 'runs', req.params.runId), 'result.json')));
  });
  app.get('/api/runs/:runId/logs', (req, res) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.runId)) throw new HttpError(400, 'Invalid run ID.');
    const dir = path.join(dataDir, 'runs', req.params.runId);
    let file;
    if (req.query.case) file = path.join(dir, 'cases', name(req.query.case), `run.${req.query.stream === 'stdout' ? 'stdout' : 'stderr'}.log`);
    else file = path.join(dir, `compile.${req.query.stream === 'stdout' ? 'stdout' : 'stderr'}.log`);
    res.type('text/plain').send(fs.readFileSync(ownedFile(path.dirname(file), path.basename(file)), 'utf8'));
  });
  app.get('/api/runs/:runId/source', (req, res) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.runId)) throw new HttpError(400, 'Invalid run ID.');
    const dir = path.join(dataDir, 'runs', req.params.runId);
    const report = readJSON(ownedFile(dir, 'result.json'));
    const code = fs.readFileSync(ownedFile(path.join(dir, 'source', 'problem'), `solution-${name(report.solution)}.c`), 'utf8');
    res.type('text/plain').send(code);
  });
  app.post('/api/problems/:id/submissions', async (req, res) => {
    const variant = name(req.body.solution || 'master');
    const currentHash = hash(fs.readFileSync(solutionFile(req.params.id, variant)));
    if (!req.body.sourceHash || req.body.sourceHash !== currentHash) throw new HttpError(409, 'Save or reload the solution before preparing a submission.');
    const snap = await runCommand(['snapshot', String(Number(req.params.id)), variant]);
    if (snap.sourceHash !== currentHash) throw new HttpError(409, 'Solution changed while preparing the snapshot. Try again.');
    await sync();
    const run = await db.run.findFirst({ where: { problemId: Number(req.params.id), solution: variant, sourceHash: snap.sourceHash, contextHash: snap.contextHash }, orderBy: { startedAt: 'desc' } });
    const record = await db.submission.create({ data: { id: snap.id, problemId: snap.problemId, solution: variant, sourceHash: snap.sourceHash, commitSha: snap.commitSha, runId: run?.id } });
    res.status(201).json({ ...record, code: snap.code, testStatus: run?.status || 'untested' });
  });
  app.get('/api/submissions/:id/code', async (req, res) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.id)) throw new HttpError(400, 'Invalid submission ID.');
    const record = await db.submission.findUnique({ where: { id: req.params.id } });
    if (!record) throw new HttpError(404, 'Submission not found.');
    const result = await promisify(execFile)('git', ['-C', path.join(dataDir, 'snapshots'), 'show', `${record.commitSha}:${record.id}/submission.c`], { maxBuffer: 2 * 1024 * 1024 });
    res.type('text/plain').send(result.stdout);
  });
  app.patch('/api/submissions/:id', async (req, res) => {
    if (!['pending', 'success', 'fail'].includes(req.body.result) || typeof req.body.memo !== 'string' || req.body.memo.length > 10000) throw new HttpError(400, 'Provide result (pending/success/fail) and memo.');
    if (!await db.submission.findUnique({ where: { id: req.params.id } })) throw new HttpError(404, 'Submission not found.');
    res.json(await db.submission.update({ where: { id: req.params.id }, data: { result: req.body.result, memo: req.body.memo } }));
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'Server error. See the service log.' : error.message });
  });
  const interval = setInterval(() => sync().catch(error => console.error('Indexing:', error.message)), 2000);
  interval.unref();
  return { app, db, stopSourceEvents: () => sourceEvents.close(), close: async () => { clearInterval(interval); sourceEvents.close(); await db.$disconnect(); } };
}

if (process.argv[1] === path.join(appDir, 'server/index.mjs')) {
  try {
    const { app, close, stopSourceEvents } = await createApp();
    console.log(`Workspace: ${dataDir}`);
    console.log(`SQLite database: ${databaseFile}`);
    const server = app.listen(port, host, () => console.log(`LeetCode C Workbench listening at http://${host}:${port}`));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
      stopSourceEvents();
      server.close(async () => { await close(); process.exit(0); });
    });
  } catch (error) {
    console.error(`Startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
