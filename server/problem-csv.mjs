function csvCell(value) {
  let text = String(value);
  // Quoting alone does not stop spreadsheet formulas in imported metadata.
  if (/^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function problemCsv(problems) {
  const rows = [['problem-id', 'problem-url', 'difficulty', 'passed', 'accepted']];
  for (const problem of problems) {
    const latest = problem.runs[0];
    rows.push([problem.id, problem.url, problem.difficulty, latest ? latest.status === 'passed' : '', problem.accepted]);
  }
  // The BOM helps spreadsheet applications recognize UTF-8; records use CRLF.
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
