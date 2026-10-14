import fs from 'node:fs';
import crypto from 'node:crypto';
import { HttpError, problemDir, problemFingerprint, importBundle } from './workspace.mjs';
import { readProblemZip } from './problem-zip.mjs';

const snapshot = id => { const dir = problemDir(id); return fs.existsSync(dir) ? problemFingerprint(dir) : null; };
export function createBatchImports({ python, active, syncProblem }) {
  const jobs = new Map(), lifetime = 10 * 60 * 1000;
  function expire() { for (const [token, job] of jobs) if (job.expiresAt <= Date.now()) jobs.delete(token); }
  const timer = setInterval(expire, 60000); timer.unref();
  return {
    async preview(raw) {
      const { entries, collectionReport } = await readProblemZip(raw, python);
      expire(); while (jobs.size >= 3) jobs.delete(jobs.keys().next().value);
      const token = crypto.randomUUID(), expiresAt = Date.now() + lifetime;
      const items = entries.map(entry => ({ ...entry, hash: snapshot(entry.bundle.manifest.id) }));
      jobs.set(token, { expiresAt, items });
      return { token, expiresAt, collectionReport, problems: items.map(item => ({ id: item.bundle.manifest.id, title: item.bundle.manifest.title, difficulty: item.bundle.manifest.difficulty, path: item.path, existing: item.hash !== null })) };
    },
    async commit(body) {
      expire(); const job = jobs.get(body?.token);
      if (!job) throw new HttpError(410, 'ZIP preview expired or already used. Preview the ZIP again.');
      if (!Array.isArray(body.items) || body.items.length !== job.items.length) throw new HttpError(400, 'Choose an action for every problem in the preview.');
      const actions = new Map();
      for (const item of body.items) {
        if (!item || !Number.isInteger(item.id) || actions.has(item.id) || !['import', 'skip', 'overwrite'].includes(item.action)) throw new HttpError(400, 'Invalid or duplicate batch action.');
        actions.set(item.id, item.action);
      }
      for (const item of job.items) {
        const id = item.bundle.manifest.id, action = actions.get(id);
        if (!action) throw new HttpError(400, 'Batch actions do not match this preview.');
        if (action === 'skip') continue;
        if ((item.hash !== null) !== (action === 'overwrite')) throw new HttpError(400, 'Existing problems require overwrite or skip; new problems require import or skip.');
        if (action === 'overwrite' && body.confirmedOverwrite !== true) throw new HttpError(428, 'Confirm replacement of existing problem files and all solution variants.');
        if ([...active].some(key => key.startsWith(`${id}/`))) throw new HttpError(409, 'Wait for active web runs to finish before batch import.');
        if (snapshot(id) !== item.hash) throw new HttpError(409, `Problem ${id} changed after preview. Preview the ZIP again.`, { code: 'problem_changed' });
      }
      jobs.delete(body.token); // One commit per preview, including partial outcomes.
      const results = [];
      for (const item of job.items) {
        const id = item.bundle.manifest.id, action = actions.get(id);
        if (action === 'skip') { results.push({ id, status: 'skipped' }); continue; }
        try {
          if ([...active].some(key => key.startsWith(`${id}/`))) throw new HttpError(409, 'A web run started after preview. Retry this problem after it finishes.');
          const result = importBundle({ ...item.bundle, ...(action === 'overwrite' ? { overwrite: true, expectedHash: item.hash } : {}) });
          let indexPending = false;
          try { await syncProblem(id); } catch (error) { console.error('Batch indexing:', error.message); indexPending = true; }
          results.push({ ...result, status: 'imported', indexPending });
        } catch (error) { results.push({ id, status: 'failed', error: error.message }); }
      }
      return { results };
    },
    close() { clearInterval(timer); jobs.clear(); },
  };
}
