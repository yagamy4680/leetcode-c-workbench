import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.mjs';
import { hash, readJSON, problemDir, ownedFile } from './workspace.mjs';

export async function syncProblem(db, id) {
  const dir = problemDir(id);
  const meta = readJSON(ownedFile(dir, 'manifest.json'));
  const fields = { title: meta.title, slug: meta.slug, difficulty: meta.difficulty, topics: JSON.stringify(meta.topics), url: meta.url };
  await db.problem.upsert({ where: { id: Number(id) }, create: { id: Number(id), ...fields }, update: fields });
  const names = [];
  for (const filename of fs.readdirSync(dir)) {
    const match = /^solution-([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.c$/.exec(filename);
    if (!match) continue;
    const sourceHash = hash(fs.readFileSync(ownedFile(dir, filename)));
    names.push(match[1]);
    await db.solution.upsert({ where: { problemId_name: { problemId: Number(id), name: match[1] } }, create: { problemId: Number(id), name: match[1], sourceHash }, update: { sourceHash } });
  }
  await db.solution.deleteMany({ where: { problemId: Number(id), name: { notIn: names } } });
}

export async function syncRuns(db) {
  const root = path.join(dataDir, 'runs');
  if (!fs.existsSync(root)) return;
  for (const id of fs.readdirSync(root)) {
    if (!/^[a-f0-9]{32}$/.test(id)) continue;
    const file = path.join(root, id, 'result.json');
    if (!fs.existsSync(file)) continue;
    const run = readJSON(file);
    if (run.status === 'running' || run.durationMs === undefined || run.id !== id) continue;
    if (!await db.problem.findUnique({ where: { id: run.problemId } })) continue;
    await db.run.upsert({ where: { id }, update: {}, create: {
      id, problemId: run.problemId, solution: run.solution, sourceHash: run.sourceHash, buildHash: run.buildHash, contextHash: run.contextHash || '',
      status: run.status, passed: run.passed, total: run.total, durationMs: run.durationMs, startedAt: new Date(run.startedAt)
    } });
  }
}

export function createIndexer(db) {
  let current;
  return function sync() {
    if (current) return current;
    current = (async () => {
      const root = path.join(dataDir, 'problems');
      if (fs.existsSync(root)) for (const id of fs.readdirSync(root).filter(n => /^\d+$/.test(n))) await syncProblem(db, id);
      await syncRuns(db);
    })().finally(() => { current = undefined; });
    return current;
  };
}
