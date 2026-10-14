#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--help') || !args.length) {
  console.log('Usage: node scripts/validate-problem.mjs [--json] [--request] <problem.json|->\nExit codes: 0 valid, 1 invalid bundle/JSON, 2 usage or file error.\nDefault: portable artifact validation. --request permits overwrite confirmation fields.');
  process.exit(args.includes('--help') ? 0 : 2);
}
const jsonOutput = args.includes('--json'), artifact = !args.includes('--request');
const paths = args.filter(arg => !['--json', '--request'].includes(arg));
if (paths.length !== 1 || (paths[0].startsWith('--'))) { console.error('Provide exactly one input file or - for stdin.'); process.exit(2); }
let validateProblemBundle;
try { ({ validateProblemBundle } = await import('../server/problem-bundle.mjs')); }
catch (error) { console.error('Validator configuration error: ' + error.message); process.exit(2); }
let raw;
try { raw = fs.readFileSync(paths[0] === '-' ? 0 : paths[0], 'utf8'); }
catch (error) { console.error('Cannot read input: ' + error.message); process.exit(2); }
let errors;
try {
  let bundle;
  try { bundle = JSON.parse(raw); }
  catch { errors = [{ path: '', message: 'invalid JSON syntax' }]; }
  if (!errors) errors = validateProblemBundle(bundle, { rawBytes: Buffer.byteLength(raw), artifact });
} catch (error) { console.error('Validator configuration error: ' + error.message); process.exit(2); }
if (jsonOutput) console.log(JSON.stringify({ valid: !errors.length, errors }, null, 2));
else if (errors.length) for (const error of errors) console.error(`${error.path || '/'}: ${error.message}`);
else console.log('Valid workbench problem bundle.');
process.exitCode = errors.length ? 1 : 0;
