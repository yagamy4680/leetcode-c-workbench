#!/usr/bin/env node
import fs from 'node:fs';
import { readProblemZip } from '../server/problem-zip.mjs';
const args = process.argv.slice(2), paths = args.filter(arg => arg !== '--json');
if (paths.length !== 1) { console.error('Usage: node scripts/validate-problem-zip.mjs [--json] problems.zip'); process.exit(2); }
try {
  const { entries, collectionReport } = await readProblemZip(fs.readFileSync(paths[0]));
  const result = { valid: true, count: entries.length, ids: entries.map(entry => entry.bundle.manifest.id), unavailable: collectionReport?.unavailable ?? [] };
  console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : `Valid ZIP: ${result.count} problem bundles.`);
} catch (error) { console.error(args.includes('--json') ? JSON.stringify({ valid: false, error: error.message }) : error.message); process.exitCode = error.code === 'ENOENT' ? 2 : 1; }
