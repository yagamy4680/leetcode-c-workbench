/* Infer only JSON container/value types; the C driver defines deeper semantics. */
window.WbTestCase = (() => {
  const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
  const types = values => new Set(values.map(kind));
  const fits = (value, allowed) => !allowed.size || allowed.has(kind(value)) || (kind(value) === 'integer' && allowed.has('number'));
  function infer(tests) {
    const inputs = tests.map(test => test.input), outputs = tests.map(test => test.expected);
    const first = inputs[0];
    const fields = first && kind(first) === 'object' ? Object.keys(first) : [];
    const keyed = fields.length && inputs.every(input => kind(input) === 'object' && Object.keys(input).length === fields.length && fields.every(field => Object.hasOwn(input, field)));
    return { fields: keyed ? fields : [], inputTypes: types(inputs), outputTypes: types(outputs), fieldTypes: Object.fromEntries(keyed ? fields.map(field => [field, types(inputs.map(input => input[field]))]) : []) };
  }
  function value(text, allowed, label) {
    if (!text.trim()) throw new Error(`${label} is required. Use [] for an empty array or "" for an empty string.`);
    let result;
    try { result = JSON.parse(text); }
    catch { if (allowed.size === 1 && allowed.has('string') && !text.trim().startsWith('"')) result = text; else throw new Error(`${label} must be valid JSON. Check brackets, commas, quotes, and null values.`); }
    if (!fits(result, allowed)) throw new Error(`${label} should be ${[...allowed].join(' or ')}, not ${kind(result)}.`);
    return result;
  }
  function parseInput(text, model) {
    if (!model.fields.length) return value(text, model.inputTypes, 'Input');
    let input;
    try { input = JSON.parse(text); } catch { /* Try LeetCode's named input below. */ }
    if (kind(input) !== 'object') {
      const assignments = [...text.matchAll(/(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/g)];
      if (assignments.length) {
        input = {};
        assignments.forEach((match, index) => {
          const field = match[1];
          if (!model.fields.includes(field) || Object.hasOwn(input, field)) throw new Error(`Unknown or repeated input field: ${field}.`);
          input[field] = value(text.slice(match.index + match[0].length, assignments[index + 1]?.index), model.fieldTypes[field], field);
        });
      } else if (model.fields.length === 1) input = { [model.fields[0]]: value(text, model.fieldTypes[model.fields[0]], model.fields[0]) };
      else throw new Error('Paste a JSON object with all input fields, or one name = value assignment per field.');
    }
    if (Object.keys(input).length !== model.fields.length || model.fields.some(field => !Object.hasOwn(input, field))) throw new Error(`Input must contain exactly these fields: ${model.fields.join(', ')}.`);
    for (const field of model.fields) if (!fits(input[field], model.fieldTypes[field])) throw new Error(`${field} should be ${[...model.fieldTypes[field]].join(' or ')}.`);
    return input;
  }
  function parse(input, expected, tests) {
    const model = infer(tests);
    return { input: parseInput(input, model), expected: value(expected, model.outputTypes, 'Expected output') };
  }
  function summary(tests) {
    const model = infer(tests), text = set => [...set].join(' or ') || 'JSON';
    return { input: model.fields.length ? model.fields.map(field => `${field}: ${text(model.fieldTypes[field])}`).join(' · ') : text(model.inputTypes), expected: text(model.outputTypes) };
  }
  return { infer, parse, summary };
})();
