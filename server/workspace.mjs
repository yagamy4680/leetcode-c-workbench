import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './config.mjs';

import { validateProblemBundle, validateProblemTests, withPreamble } from './problem-bundle.mjs';

export class HttpError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
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
  const errors = validateProblemTests(tests);
  if (errors.length) throw new HttpError(400, 'Invalid test cases: ' + errors[0].path + ' ' + errors[0].message, { validationErrors: errors });
  return tests;
}
export function problemFingerprint(dir) {
  const entries = [];
  function visit(root, prefix = '') {
    for (const filename of fs.readdirSync(root).sort()) {
      const file = path.join(root, filename), relative = prefix + filename;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new HttpError(400, 'Workspace symlinks are not supported.');
      if (stat.isDirectory()) { entries.push([relative, 'directory']); visit(file, relative + '/'); }
      else if (stat.isFile()) entries.push([relative, hash(fs.readFileSync(file))]);
      else throw new HttpError(400, 'Unsupported workspace file.');
    }
  }
  visit(dir);
  return hash(JSON.stringify(entries));
}
export function importBundle(bundle) {
  const errors = validateProblemBundle(bundle);
  if (errors.length) throw new HttpError(400, 'Invalid problem bundle: ' + errors[0].path + ' ' + errors[0].message, { validationErrors: errors });
  const { manifest: meta, description, files, tests } = bundle;
  const dir = problemDir(meta.id);
  const sources = meta.sources ?? ['main.c'], headers = meta.headers ?? [];
  const exists = fs.existsSync(dir);
  const expectedHash = exists ? problemFingerprint(dir) : null;
  if (exists && bundle.overwrite !== true) throw new HttpError(409, 'Problem already exists. Confirm before replacing its files and solutions.', { code: 'problem_exists', id: meta.id, expectedHash });
  if (exists && !bundle.expectedHash) throw new HttpError(428, 'expectedHash is required to confirm the existing problem.');
  if (exists && bundle.expectedHash !== expectedHash) throw new HttpError(409, 'Problem changed since confirmation. Import again to review the latest version.', { code: 'problem_changed' });
  if (!exists && bundle.overwrite === true) throw new HttpError(409, 'Problem disappeared since confirmation. Import again.', { code: 'problem_changed' });
  const parent = path.dirname(dir);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, '.import-'));
  let backup;
  try {
    for (const [filename, content] of Object.entries(files)) {
      if (!/^[A-Za-z0-9_-]+\.(c|h)$/.test(filename) || typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) throw new HttpError(400, 'Invalid framework file.');
      const source = filename === 'solution-master.c' ? withPreamble(content) : content;
      if (Buffer.byteLength(source) > 1024 * 1024) throw new HttpError(400, 'Framework file exceeds 1 MiB with its preamble.');
      fs.writeFileSync(path.join(staging, filename), source);
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ ...meta, sources, headers }, null, 2) + '\n');
    fs.writeFileSync(path.join(staging, 'description.md'), description);
    fs.writeFileSync(path.join(staging, 'tests.json'), JSON.stringify(tests, null, 2) + '\n');
    if (exists) {
      if (problemFingerprint(dir) !== expectedHash) throw new HttpError(409, 'Problem changed while preparing the import. Import again.', { code: 'problem_changed' });
      const backupRoot = path.join(dataDir, 'import-backups');
      fs.mkdirSync(backupRoot, { recursive: true });
      backup = path.join(backupRoot, `${meta.id}-${Date.now()}-${crypto.randomUUID()}`);
      fs.renameSync(dir, backup);
    }
    try { fs.renameSync(staging, dir); }
    catch (error) { if (backup) { fs.renameSync(backup, dir); backup = undefined; } throw error; }
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { id: meta.id, overwritten: exists, ...(backup ? { backupPath: path.relative(dataDir, backup) } : {}) };
}
