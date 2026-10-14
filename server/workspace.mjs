import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appDir, dataDir } from './config.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const hash = content => crypto.createHash('sha256').update(content).digest('hex');
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function name(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new HttpError(400, 'Invalid name; use letters, digits, underscores or hyphens.');
  return value;
}
export function problemDir(id) {
  if (!/^\d+$/.test(String(id)) || Number(id) < 1 || Number(id) > 999999) throw new HttpError(400, 'Invalid problem ID.');
  const dir = path.join(dataDir, 'problems', String(Number(id)));
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new HttpError(400, 'Workspace symlinks are not supported.');
  return dir;
}
export function ownedFile(dir, filename) {
  const file = path.join(dir, filename);
  if (!fs.existsSync(file)) throw new HttpError(404, 'File not found.');
  if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new HttpError(400, 'Not a regular workspace file.');
  return file;
}
export const solutionFile = (id, variant) => ownedFile(problemDir(id), `solution-${name(variant)}.c`);
export function atomic(file, content) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}
export function saveChecked(file, content, expectedHash) {
  if (!expectedHash) throw new HttpError(428, 'expectedHash is required to protect local edits.');
  if (hash(fs.readFileSync(file)) !== expectedHash) throw new HttpError(409, 'File changed on disk. Reload before saving.');
  atomic(file, content);
  return hash(content);
}
export function validateTests(tests) {
  if (!Array.isArray(tests) || tests.length < 1 || tests.length > 10000) throw new HttpError(400, 'Provide 1–10000 test cases.');
  const seen = new Set();
  for (const test of tests) {
    if (!test || typeof test !== 'object' || !Object.hasOwn(test, 'input') || !Object.hasOwn(test, 'expected')) throw new HttpError(400, 'Each test requires id, input and expected.');
    name(test.id);
    if (seen.has(test.id)) throw new HttpError(400, `Duplicate case ID: ${test.id}`);
    seen.add(test.id);
    if (!['exact', 'unordered', 'float'].includes(test.compare || 'exact')) throw new HttpError(400, 'Unknown comparison mode.');
    if (test.timeoutMs !== undefined && (!Number.isInteger(test.timeoutMs) || test.timeoutMs < 10 || test.timeoutMs > 60000)) throw new HttpError(400, 'timeoutMs must be 10–60000.');
    if (test.tolerance !== undefined && (typeof test.tolerance !== 'number' || !Number.isFinite(test.tolerance) || test.tolerance < 0)) throw new HttpError(400, 'Invalid float tolerance.');
  }
  return tests;
}
export function importBundle(bundle) {
  const { manifest: meta, description, files, tests } = bundle;
  if (!meta || !Number.isInteger(meta.id) || typeof meta.title !== 'string' || !meta.title.trim() || typeof meta.slug !== 'string' || !Array.isArray(meta.topics) || meta.topics.some(t => typeof t !== 'string') || !['Easy', 'Medium', 'Hard'].includes(meta.difficulty) || typeof meta.url !== 'string') throw new HttpError(400, 'Invalid manifest metadata.');
  const dir = problemDir(meta.id);
  if (fs.existsSync(dir)) throw new HttpError(409, 'Problem already exists. Import never overwrites local solutions.');
  if (typeof description !== 'string' || !files || typeof files !== 'object' || Array.isArray(files)) throw new HttpError(400, 'description and files are required.');
  validateTests(tests);
  for (const required of ['main.c', 'solution.h', 'solution-master.c']) if (typeof files[required] !== 'string') throw new HttpError(400, `Missing ${required}.`);
  if (Object.keys(files).length > 64) throw new HttpError(400, 'Too many framework files.');
  const sources = meta.sources || ['main.c'];
  const headers = meta.headers || [];
  if (!Array.isArray(sources) || !sources.includes('main.c') || sources.some(s => typeof s !== 'string' || !/^[A-Za-z0-9_-]+\.c$/.test(s) || s.startsWith('solution-') || !Object.hasOwn(files, s))) throw new HttpError(400, 'Invalid framework sources.');
  if (!Array.isArray(headers) || headers.some(h => typeof h !== 'string' || !/^[A-Za-z0-9_-]+\.h$/.test(h) || !Object.hasOwn(files, h))) throw new HttpError(400, 'Invalid framework headers.');
  const parent = path.dirname(dir);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, '.import-'));
  try {
    for (const [filename, content] of Object.entries(files)) {
      if (!/^[A-Za-z0-9_-]+\.(c|h)$/.test(filename) || typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) throw new HttpError(400, 'Invalid framework file.');
      const source = filename === 'solution-master.c' && !/^#define WB_DEBUG_PREAMBLE$/m.test(content)
        ? fs.readFileSync(path.join(appDir, 'templates/solution-preamble.c'), 'utf8') + content : content;
      if (Buffer.byteLength(source) > 1024 * 1024) throw new HttpError(400, 'Framework file exceeds 1 MiB with its preamble.');
      fs.writeFileSync(path.join(staging, filename), source);
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ ...meta, sources, headers }, null, 2) + '\n');
    fs.writeFileSync(path.join(staging, 'description.md'), description);
    fs.writeFileSync(path.join(staging, 'tests.json'), JSON.stringify(tests, null, 2) + '\n');
    fs.renameSync(staging, dir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return meta.id;
}
