import fs from 'node:fs';
import Ajv from 'ajv';

const schema = JSON.parse(fs.readFileSync(new URL('../docs/problem.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const checkBundle = ajv.compile(schema);
const checkTests = ajv.compile(schema.definitions.tests);
export const MAX_SOURCE_BYTES = 1024 * 1024;
export const MAX_BUNDLE_BYTES = 12 * 1024 * 1024;
const preambleFile = new URL('../templates/solution-preamble.c', import.meta.url);
const owns = (object, key) => Object.hasOwn(object, key);
const pointer = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const schemaErrors = check => (check.errors || []).map(error => ({
  path: error.instancePath + (error.keyword === 'required' ? '/' + pointer(error.params.missingProperty) : ''),
  message: error.message,
}));

export function withPreamble(code) {
  return /^#define WB_DEBUG_PREAMBLE$/m.test(code) ? code : fs.readFileSync(preambleFile, 'utf8') + code;
}
export function validateProblemTests(tests) {
  if (!checkTests(tests)) return schemaErrors(checkTests);
  const errors = [], ids = new Set();
  tests.forEach((test, index) => {
    if (ids.has(test.id)) errors.push({ path: `/${index}/id`, message: 'duplicate test ID' });
    ids.add(test.id);
  });
  return errors;
}
export function validateProblemBundle(bundle, { rawBytes, artifact = false } = {}) {
  if (!checkBundle(bundle)) return schemaErrors(checkBundle);
  const errors = validateProblemTests(bundle.tests).map(error => ({ ...error, path: '/tests' + error.path }));
  const add = (path, message) => errors.push({ path, message });
  if (artifact) for (const key of ['overwrite', 'expectedHash']) {
    if (owns(bundle, key)) add('/' + key, 'request-only confirmation field must not be stored in a problem bundle');
  }
  const sources = bundle.manifest.sources ?? ['main.c'], headers = bundle.manifest.headers ?? [];
  for (const [key, names] of [['sources', sources], ['headers', headers]]) {
    names.forEach((filename, index) => {
      if (!owns(bundle.files, filename)) add(`/manifest/${key}/${index}`, 'referenced file is missing from files');
    });
  }
  for (const [filename, code] of Object.entries(bundle.files)) {
    if (Buffer.byteLength(code) > MAX_SOURCE_BYTES) add('/files/' + pointer(filename), 'source exceeds 1 MiB in UTF-8');
  }
  const master = withPreamble(bundle.files['solution-master.c']);
  if (Buffer.byteLength(master) > MAX_SOURCE_BYTES) add('/files/solution-master.c', 'source plus debug preamble exceeds 1 MiB in UTF-8');
  if ((rawBytes ?? Buffer.byteLength(JSON.stringify(bundle))) > MAX_BUNDLE_BYTES) add('', 'JSON request exceeds 12 MiB');
  return errors;
}
