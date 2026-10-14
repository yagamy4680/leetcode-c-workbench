import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateProblemBundle } from './problem-bundle.mjs';

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export async function readProblemZip(raw, python = process.env.PYTHON || 'python3') {
  if (!Buffer.isBuffer(raw) || raw.length > MAX_ARCHIVE_BYTES) throw new Error('Provide a ZIP file of at most 32 MiB.');
  const parsed = await new Promise((resolve, reject) => {
    const child = spawn(python, [fileURLToPath(new URL('../scripts/read-problem-zip.py', import.meta.url))]);
    const chunks = []; let size = 0, errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('ZIP processing timed out.')); }, 20000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 96 * 1024 * 1024) { child.kill(); reject(new Error('ZIP output exceeds its processing limit.')); } else chunks.push(chunk); });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(0, 2000); });
    child.stdin.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', () => {
      clearTimeout(timer);
      try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (data.error) reject(new Error(data.error)); else resolve(data); }
      catch { reject(new Error(errors || 'Cannot read ZIP contents.')); }
    });
    child.stdin.end(raw);
  });
  for (const entry of parsed.entries) {
    const errors = validateProblemBundle(entry.bundle, { rawBytes: entry.bytes, artifact: true });
    if (errors.length) throw Object.assign(new Error(`${entry.path}: ${errors[0].path} ${errors[0].message}`), { validationErrors: errors, path: entry.path });
  }
  return parsed;
}
