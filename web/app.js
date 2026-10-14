/* Plain browser JS; all persistent edits use hashes to protect local changes. */
const $ = id => document.getElementById(id);
const state = { problems: [], problem: null, variant: 'master', sourceHash: '', savedCode: '', testsHash: '', savedTests: '', report: null, running: false, preparing: false, loading: false, viewEpoch: 0, savingCode: null, savingTests: null, snapshot: null, live: '', externalConflict: false };
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const label = value => String(value).replaceAll('_', ' ');
const date = value => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function notice(text, error = false) { $('notice').hidden = !text; $('notice').textContent = text; $('notice').className = error ? 'error' : ''; }
async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw Object.assign(new Error(body.error || `Request failed (${res.status}).`), { status: res.status, details: body }); }
  return res;
}
async function json(url, method = 'GET', body) { return (await api(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) })).json(); }
function bind(id, event, action) { $(id).addEventListener(event, e => Promise.resolve(action(e)).catch(error => notice(error.message, true))); }
function dirty() { return $('code').value !== state.savedCode; }
function testsDirty() { return $('tests-json').value !== state.savedTests; }
function navigationBusy() { return state.running || state.preparing || state.loading || state.savingCode || state.savingTests; }
function syncEditorScroll() {
  const editor = $('code');
  if (editor.clientHeight) $('line-numbers').style.height = `${editor.clientHeight}px`;
  $('line-numbers').scrollTop = editor.scrollTop;
  $('highlight-code').style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
}
function highlightCode() {
  const prism = window.Prism;
  const enabled = Boolean(prism?.languages?.c);
  $('source-surface').classList.toggle('highlighted', enabled);
  if (enabled) {
    const code = $('code').value;
    // Retain a final empty row, matching textarea height and line numbering.
    $('highlight-code').innerHTML = prism.highlight(code + (code.endsWith('\n') ? ' ' : ''), prism.languages.c, 'c');
  }
  syncEditorScroll();
}
function lines() { $('line-numbers').textContent = Array.from({ length: $('code').value.split('\n').length }, (_, i) => i + 1).join('\n'); $('saved-state').textContent = state.externalConflict ? 'Changed on disk — reload required' : (dirty() ? 'Unsaved changes' : 'Saved'); highlightCode(); }
function activateTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(button => { const on = button.dataset.tab === tab; button.classList.toggle('active', on); if (on) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  for (const name of ['solution', 'tests', 'description', 'history']) $(`${name}-tab`).hidden = name !== tab;
  if (tab === 'solution') syncEditorScroll();
}
function renderProblems() {
  const query = $('search').value.toLowerCase();
  const items = state.problems.filter(p => `${p.id} ${p.title}`.toLowerCase().includes(query));
  $('problems').innerHTML = items.length ? items.map(p => `<button type="button" class="problem-item" data-problem="${p.id}" ${p.id === state.problem?.id ? 'aria-current="page"' : ''}><strong>${p.id}. ${esc(p.title)}</strong><small>${esc(p.difficulty)} · ${p.solutions.length} solution${p.solutions.length === 1 ? '' : 's'}${p.runs[0] ? ` · ${esc(label(p.runs[0].status))}` : ''}</small></button>`).join('') : '<p class="muted">No matching problems. Import a problem to add it.</p>';
}
async function refresh() { state.problems = await json('/api/problems'); renderProblems(); }
function applyCode(result, variant) {
  state.externalConflict = false;
  state.variant = variant; state.sourceHash = result.hash; state.savedCode = result.code;
  $('code').value = result.code; $('variant').value = variant; $('code-label').textContent = `solution-${variant}.c`; lines(); connectSourceEvents();
}
let sourceEvents = null, sourceEventsKey = '', sourceRefreshTimer;
function connectSourceEvents() {
  if (!window.EventSource || !state.problem) return;
  const key = `${state.problem.id}/${state.variant}`;
  if (key === sourceEventsKey) return;
  sourceEvents?.close(); clearTimeout(sourceRefreshTimer);
  sourceEventsKey = key;
  const stream = sourceEvents = new EventSource(`/api/problems/${state.problem.id}/solutions/${encodeURIComponent(state.variant)}/events`);
  stream.onmessage = event => {
    if (stream !== sourceEvents) return;
    const update = JSON.parse(event.data);
    if (update.hash !== state.sourceHash || state.externalConflict) scheduleSourceRefresh();
  };
}
function scheduleSourceRefresh() {
  clearTimeout(sourceRefreshTimer);
  sourceRefreshTimer = setTimeout(() => refreshExternalCode().catch(error => notice(error.message, true)), 100);
}
async function refreshExternalCode() {
  if (!state.problem) return;
  if (navigationBusy()) { scheduleSourceRefresh(); return; }
  const id = state.problem.id, variant = state.variant, epoch = state.viewEpoch;
  const baseline = state.sourceHash;
  let result;
  try { result = await json(`/api/problems/${id}/solutions/${encodeURIComponent(variant)}`); }
  catch (error) {
    if (epoch !== state.viewEpoch) return;
    state.externalConflict = true; lines();
    notice('Cannot read the solution on disk. Browser content is preserved; restore the file and reload.', true);
    return;
  }
  if (epoch !== state.viewEpoch || state.problem.id !== id || state.variant !== variant) return;
  // Recheck after the fetch: typing or saving may have started in flight.
  if (navigationBusy() || state.sourceHash !== baseline) { scheduleSourceRefresh(); return; }
  if (result.hash === state.sourceHash) { state.externalConflict = false; lines(); return; }
  if (dirty()) {
    state.externalConflict = true; lines();
    notice('Solution changed on disk. Your unsaved browser edits are preserved. Copy them before using Reload from disk.', true);
    return;
  }
  const editor = $('code');
  const start = editor.selectionStart, end = editor.selectionEnd, top = editor.scrollTop, left = editor.scrollLeft;
  applyCode(result, variant);
  editor.setSelectionRange(Math.min(start, result.code.length), Math.min(end, result.code.length));
  editor.scrollTop = top; editor.scrollLeft = left; syncEditorScroll();
  if (state.report) showReport(state.report);
  notice('Solution updated from disk.');
}
window.addEventListener('pagehide', () => { sourceEvents?.close(); clearTimeout(sourceRefreshTimer); });
window.addEventListener('pageshow', event => { if (event.persisted) { sourceEventsKey = ''; connectSourceEvents(); } });
async function loadCode(variant = state.variant, epoch = ++state.viewEpoch) {
  const id = state.problem.id; state.loading = true;
  try {
    const result = await json(`/api/problems/${id}/solutions/${encodeURIComponent(variant)}`);
    if (epoch !== state.viewEpoch || state.problem.id !== id) return;
    applyCode(result, variant);
  } catch (error) { if (epoch === state.viewEpoch) $('variant').value = state.variant; throw error; }
  finally { if (epoch === state.viewEpoch) state.loading = false; }
}
async function loadProblem(id, keepTab = false, discardConfirmed = false) {
  if (!discardConfirmed && (dirty() || testsDirty()) && !confirm('Discard unsaved browser changes and reload?')) return;
  const epoch = ++state.viewEpoch; state.loading = true;
  try {
  const p = await json(`/api/problems/${id}`);
  const variant = p.solutions.some(s => s.name === state.variant) ? state.variant : (p.solutions.find(s => s.name === 'master')?.name || p.solutions[0]?.name);
  if (!variant) throw new Error('No solution found. Restore solution-master.c in the workspace.');
  const code = await json(`/api/problems/${id}/solutions/${encodeURIComponent(variant)}`);
  if (epoch !== state.viewEpoch) return;
  // Commit the identity and editor together only after both requests succeed.
  state.problem = p;
  $('problem').hidden = false; $('empty').hidden = true; $('problem-title').textContent = `${p.id}. ${p.title}`;
  $('problem-meta').textContent = `${p.difficulty} · ${p.manifest.topics.join(' · ')}`;
  const original = /^https:\/\/leetcode\.com\/problems\//.test(p.url) ? p.url : 'https://leetcode.com';
  $('original-link').href = original; $('submit-original').href = original;
  $('description-tab').innerHTML = DOMPurify.sanitize(marked.parse(p.description));
  $('variant').innerHTML = p.solutions.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
  applyCode(code, variant);
  state.savedTests = JSON.stringify(p.tests, null, 2); $('tests-json').value = state.savedTests; state.testsHash = p.testsHash;
  $('case-select').innerHTML = '<option value="">All cases</option>' + p.tests.map(t => `<option>${esc(t.id)}</option>`).join('');
  state.report = null; $('case-results').innerHTML = ''; $('diagnostics').innerHTML = ''; $('run-summary').textContent = 'Save and run with ⌘/Ctrl Enter.'; $('run-state').textContent = 'Ready'; $('tested-code').hidden = true;
  renderHistory(); renderProblems(); if (!keepTab) activateTab('solution');
  } finally { if (epoch === state.viewEpoch) state.loading = false; }
}
async function saveCode() {
  if (state.loading) throw new Error('Wait for the solution to load before saving.');
  if (state.savingCode) { await state.savingCode; if (dirty()) return saveCode(); return; }
  if (!dirty()) return;
  const id = state.problem.id, variant = state.variant, submitted = $('code').value, expectedHash = state.sourceHash;
  state.savingCode = (async () => {
    const result = await json(`/api/problems/${id}/solutions/${variant}`, 'PUT', { code: submitted, expectedHash });
    if (state.problem.id === id && state.variant === variant) { state.sourceHash = result.hash; state.savedCode = submitted; lines(); notice(dirty() ? 'Submitted version saved; newer editor changes remain unsaved.' : 'Solution saved.'); }
  })();
  try { await state.savingCode; } finally { state.savingCode = null; }
}
async function saveTests() {
  if (state.loading) throw new Error('Wait for the problem to load before saving.');
  if (state.savingTests) { await state.savingTests; if (testsDirty()) return saveTests(); return; }
  const id = state.problem.id, submitted = $('tests-json').value, tests = JSON.parse(submitted), expectedHash = state.testsHash;
  state.savingTests = (async () => {
    const result = await json(`/api/problems/${id}/tests`, 'PUT', { tests, expectedHash });
    if (state.problem.id === id) { state.testsHash = result.hash; state.savedTests = submitted; state.problem.tests = tests; $('case-select').innerHTML = '<option value="">All cases</option>' + tests.map(t => `<option>${esc(t.id)}</option>`).join(''); notice(testsDirty() ? 'Submitted test cases saved; newer edits remain unsaved.' : 'Test cases saved.'); }
  })();
  try { await state.savingTests; } finally { state.savingTests = null; }
}
function renderCases(report) {
  $('case-results').innerHTML = report.cases.length ? `<table class="case-table"><thead><tr><th scope="col">Case</th><th scope="col">Result</th><th scope="col">Time</th><th scope="col">Details</th></tr></thead><tbody>${report.cases.map(c => `<tr><td>${esc(c.id)}</td><td class="status-${c.status === 'passed' ? 'passed' : 'error'}">${esc(label(c.status))}</td><td>${c.durationMs} ms</td><td><button type="button" class="btn btn-link btn-sm" data-case-log="${esc(c.id)}">Log</button>${c.status !== 'passed' ? `<details><summary>Input / result</summary><pre class="case-detail">${esc(JSON.stringify({ input: c.input, expected: c.expected, actual: c.actual, difference: c.difference, error: c.error }, null, 2))}</pre></details>` : ''}</td></tr>`).join('')}</tbody></table>` : '';
}
function showReport(report) {
  state.report = report; renderCases(report);
  $('run-state').textContent = label(report.status);
  $('run-state').className = report.status === 'passed' ? 'status-passed' : 'status-error';
  const stale = dirty() || state.variant !== report.solution || state.sourceHash !== report.sourceHash ? ' · current editor differs' : (report.testsHash !== state.testsHash ? ' · test cases have changed' : '');
  $('run-summary').textContent = `${report.passed}/${report.total} passed · ${report.durationMs} ms · ${report.cached ? 'cached build' : 'compiled'} · leak check ${report.leakCheck}${stale}`;
  $('log-source').innerHTML = '<option value="@live">Live output</option><option value="@compile">Compiler</option>' + report.cases.map(c => `<option value="case:${esc(c.id)}">${esc(c.id)}</option>`).join('');
  $('tested-code').href = `/api/runs/${report.id}/source`; $('tested-code').hidden = false;
}
function appendLog(text) {
  state.live = (state.live + text).slice(-250000);
  $('log').textContent = state.live; $('log').scrollTop = $('log').scrollHeight;
  const regex = /solution-[A-Za-z0-9_-]+\.c:(\d+)(?::\d+)?/g;
  for (const match of text.matchAll(regex)) {
    const line = Number(match[1]);
    if ($('diagnostics').querySelector(`[data-line="${line}"]`)) continue;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-sm btn-outline-secondary'; button.dataset.line = line; button.textContent = `Line ${line}`;
    button.addEventListener('click', () => {
      if (dirty() || (state.report && (state.report.sourceHash !== state.sourceHash || state.report.solution !== state.variant || state.report.problemId !== state.problem.id))) return notice('This log belongs to a different editor version. Open Tested source to inspect it.', true);
      const rows = $('code').value.split('\n'); const offset = rows.slice(0, line - 1).reduce((n, row) => n + row.length + 1, 0);
      $('code').focus(); $('code').setSelectionRange(offset, offset + (rows[line - 1]?.length || 0)); $('code').scrollTop = Math.max(0, (line - 5) * 21);
    });
    $('diagnostics').append(button);
  }
}
function setRunning(value) {
  state.running = value;
  for (const id of ['run-btn', 'variant', 'clone-btn', 'prepare-btn', 'case-select', 'mode', 'reload-code']) $(id).disabled = value;
  $('run-btn').textContent = value ? 'Running…' : 'Run tests';
}
async function runTests() {
  if (!state.problem || state.running) return;
  if (state.loading || state.preparing) return notice('Wait for the current operation to finish.');
  if (testsDirty() || state.savingTests) return notice('Save your test case changes before running tests.', true);
  setRunning(true);
  const cases = [];
  const problemId = state.problem.id, variant = state.variant;
  try {
    await saveCode(); notice(''); state.live = ''; state.report = null;
    $('log').textContent = ''; $('diagnostics').innerHTML = ''; $('case-results').innerHTML = ''; $('run-state').textContent = 'Running…'; $('run-state').className = '';
    const response = await api(`/api/problems/${problemId}/run`, { method: 'POST', body: JSON.stringify({ solution: variant, case: $('case-select').value || undefined, mode: $('mode').value, sourceHash: state.sourceHash }) });
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '', completed = false;
    const event = item => {
      if (item.type === 'error') throw new Error(item.error);
      if (item.type === 'start') state.report = item.run;
      if (item.type === 'log') appendLog(item.text);
      if (item.type === 'command') appendLog('$ ' + item.text + '\n');
      if (item.type === 'message') $('run-summary').textContent = item.text;
      if (item.type === 'case') { cases.push(item.case); renderCases({ cases }); }
      if (item.type === 'done') { completed = true; showReport(item.run); }
    };
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      let end; while ((end = pending.indexOf('\n')) >= 0) { const row = pending.slice(0, end); pending = pending.slice(end + 1); if (row) event(JSON.parse(row)); }
      if (chunk.done) break;
    }
    if (!completed) throw new Error('Run connection closed before completion. Check History or retry.');
    state.problem = await json(`/api/problems/${problemId}`); renderHistory(); await refresh();
  } catch (error) { $('run-state').textContent = 'Error / interrupted'; $('run-state').className = 'status-error'; $('run-summary').textContent = 'Check History for the recorded run, then reload or retry.'; throw error; }
  finally { setRunning(false); }
}
async function showLog() {
  if ($('log-source').value === '@live') { $('log').textContent = state.live; return; }
  if (!state.report) return;
  const selected = $('log-source').value, stream = $('log-stream').value, runId = state.report.id;
  const content = await (await api(`/api/runs/${runId}/logs?stream=${stream}${selected === '@compile' ? '' : `&case=${encodeURIComponent(selected.slice(5))}`}`)).text();
  if (state.report?.id === runId && $('log-source').value === selected && $('log-stream').value === stream) $('log').textContent = content;
}
function renderHistory() {
  const p = state.problem;
  $('submissions').innerHTML = p.submissions.length ? `<div class="table-responsive"><table class="history-table"><thead><tr><th>Date</th><th>Solution</th><th>LeetCode</th><th>Memo</th><th>Snapshot</th></tr></thead><tbody>${p.submissions.map(s => `<tr><td>${esc(date(s.createdAt))}</td><td>${esc(s.solution)}</td><td class="status-${esc(s.result)}">${esc(s.result)}</td><td>${esc(s.memo)}</td><td><button type="button" class="btn btn-sm btn-link" data-submission="${s.id}">${s.commitSha.slice(0, 8)}</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted mt-3">No submissions yet. Prepare a snapshot when your solution is ready.</p>';
  $('runs').innerHTML = p.runs.length ? `<div class="table-responsive"><table class="history-table"><thead><tr><th>Date</th><th>Solution</th><th>Local result</th><th>Cases</th><th></th></tr></thead><tbody>${p.runs.map(r => `<tr><td>${esc(date(r.startedAt))}</td><td>${esc(r.solution)}</td><td>${esc(label(r.status))}</td><td>${r.passed}/${r.total}</td><td><button type="button" class="btn btn-sm btn-link" data-run="${r.id}">Inspect</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Run tests here or from the CLI to start your history.</p>';
}
function showSnapshot(snapshot) {
  state.snapshot = snapshot; $('submission-code').value = snapshot.code; $('submission-result').value = snapshot.result;
  $('submission-memo').value = snapshot.memo; $('submission-error').textContent = '';
  $('snapshot-info').textContent = `${snapshot.solution} · ${snapshot.commitSha.slice(0, 10)} · ${snapshot.testStatus ? `local test: ${snapshot.testStatus}` : date(snapshot.createdAt)}`;
  const original = state.problems.find(p => p.id === snapshot.problemId)?.url;
  $('submit-original').href = original && /^https:\/\/leetcode\.com\/problems\//.test(original) ? original : 'https://leetcode.com';
  $('submission-dialog').showModal();
}
async function capabilities(refresh = false) {
  const info = await json('/api/doctor' + (refresh ? '?refresh=1' : ''));
  $('capabilities').innerHTML = [['ASan', info.addressSanitizer], ['UBSan', info.undefinedSanitizer], ['Leak check', info.leakSanitizer]].map(([title, available]) => `<span class="check-state">${title}: <strong>${available ? 'available' : 'unavailable'}</strong></span>`).join('');
  $('compiler-version').textContent = info.version + (!info.leakSanitizer && info.leakProbeLog ? '\n\nLeak probe:\n' + info.leakProbeLog : '');
}
bind('search', 'input', renderProblems);
bind('refresh-btn', 'click', async () => { await refresh(); notice('Problem list refreshed.'); });
bind('code', 'input', lines);
bind('code', 'scroll', syncEditorScroll);
bind('code', 'keydown', e => { if (e.key === 'Escape') { e.preventDefault(); $('save-code').focus(); } if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const start = e.target.selectionStart, end = e.target.selectionEnd; e.target.setRangeText('    ', start, end, 'end'); lines(); } });
bind('variant', 'change', async () => { const next = $('variant').value; if (navigationBusy()) { $('variant').value = state.variant; return notice('Wait for the current operation to finish.'); } if (dirty() && !confirm('Discard unsaved changes and switch solutions?')) { $('variant').value = state.variant; return; } await loadCode(next); });
bind('reload-code', 'click', async () => { if (navigationBusy()) return notice('Wait for the current operation to finish.'); if (!dirty() || confirm('Discard browser changes and reload from disk?')) await loadCode(); });
bind('save-code', 'click', saveCode);
bind('run-btn', 'click', runTests);
bind('clone-btn', 'click', () => { $('clone-form').hidden = !$('clone-form').hidden; if (!$('clone-form').hidden) $('new-name').focus(); });
bind('clone-form', 'submit', async e => { e.preventDefault(); if (navigationBusy()) return notice('Wait for the current operation to finish.'); state.preparing = true; const id = state.problem.id; try { await saveCode(); const variant = $('new-name').value; await json(`/api/problems/${id}/solutions`, 'POST', { name: variant, from: state.variant }); state.variant = variant; $('clone-form').hidden = true; await loadProblem(id, true); } finally { state.preparing = false; } });
bind('save-tests', 'click', saveTests);
bind('add-case', 'click', () => { const tests = JSON.parse($('tests-json').value); let n = tests.length + 1; while (tests.some(t => t.id === `case${n}`)) n++; tests.push({ id: `case${n}`, input: {}, expected: null }); $('tests-json').value = JSON.stringify(tests, null, 2); $('tests-json').focus(); $('tests-json').scrollTop = $('tests-json').scrollHeight; });
bind('log-source', 'change', showLog); bind('log-stream', 'change', showLog);
bind('tools-btn', 'click', async () => { $('tools').hidden = !$('tools').hidden; $('tools').open = true; if (!$('tools').hidden) await capabilities(); });
bind('probe-btn', 'click', async () => { $('probe-btn').disabled = true; try { await capabilities(true); } finally { $('probe-btn').disabled = false; } });
bind('import-btn', 'click', () => { if (navigationBusy()) return notice('Wait for the current operation to finish.'); $('import-error').textContent = ''; $('import-dialog').showModal(); });
bind('bundle-file', 'change', async () => { if ($('bundle-file').files[0]) $('bundle').value = await $('bundle-file').files[0].text(); });
bind('import-submit', 'click', async () => {
  if (navigationBusy()) { $('import-error').textContent = 'Wait for the current operation to finish.'; return; }
  state.preparing = true; $('import-submit').disabled = true; $('import-error').textContent = '';
  try {
    // Confirmation fields are request-only; never trust them from an uploaded bundle.
    const { overwrite, expectedHash, ...bundle } = JSON.parse($('bundle').value);
    if ((dirty() || testsDirty()) && !confirm('Import and open this problem? Unsaved browser edits will be discarded. Copy them first if needed.')) return;
    let result;
    try { result = await json('/api/problems', 'POST', bundle); }
    catch (error) {
      if (error.status !== 409 || error.details?.code !== 'problem_exists') throw error;
      if (!confirm(`Problem ${error.details.id} already exists. Overwrite its description, tests, framework, and ALL solution variants with this bundle? The old problem files will be backed up; run and submission history will remain.`)) {
        $('import-error').textContent = 'Import cancelled. Existing problem files were kept.'; return;
      }
      result = await json('/api/problems', 'POST', { ...bundle, overwrite: true, expectedHash: error.details.expectedHash });
    }
    $('import-dialog').close(); await refresh(); await loadProblem(result.id, false, true);
    notice(result.overwritten ? `Problem replaced. Previous files saved in ${result.backupPath}.` : 'Problem imported.');
  } catch (error) { $('import-error').textContent = error.message; notice(error.message, true); }
  finally { state.preparing = false; $('import-submit').disabled = false; }
});
bind('prepare-btn', 'click', async () => { if (navigationBusy()) return notice('Wait for the current operation to finish.'); state.preparing = true; $('prepare-btn').disabled = true; const id = state.problem.id, variant = state.variant; try { await saveCode(); showSnapshot(await json(`/api/problems/${id}/submissions`, 'POST', { solution: variant, sourceHash: state.sourceHash })); } finally { state.preparing = false; $('prepare-btn').disabled = false; } });
bind('copy-code', 'click', async () => { try { await navigator.clipboard.writeText($('submission-code').value); notice('Snapshot code copied.'); } catch { $('submission-code').focus(); $('submission-code').select(); $('submission-error').textContent = 'Press ⌘/Ctrl C to copy the selected code.'; } });
bind('save-submission', 'click', async () => { const id = state.snapshot.problemId; $('save-submission').disabled = true; try { await json(`/api/submissions/${state.snapshot.id}`, 'PATCH', { result: $('submission-result').value, memo: $('submission-memo').value }); const problem = await json(`/api/problems/${id}`); if (state.problem.id === id) { state.problem = problem; renderHistory(); } $('submission-dialog').close(); notice('Submission result saved.'); } catch (error) { $('submission-error').textContent = error.message; } finally { $('save-submission').disabled = false; } });
document.addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button) return;
  const action = async () => {
    if (button.dataset.close) $(button.dataset.close).close();
    if (button.dataset.tab) activateTab(button.dataset.tab);
    if (button.dataset.problem) { if (navigationBusy()) return notice('Wait for the current operation to finish.'); await loadProblem(Number(button.dataset.problem)); }
    if (button.dataset.caseLog) { $('log-source').value = `case:${button.dataset.caseLog}`; await showLog(); }
    if (button.dataset.run) { if (navigationBusy()) return notice('Wait for the current operation to finish.'); const id = state.problem.id, epoch = ++state.viewEpoch; const report = await json(`/api/runs/${button.dataset.run}`); if (state.problem.id !== id || epoch !== state.viewEpoch) return; showReport(report); activateTab('solution'); $('log-source').value = '@compile'; await showLog(); }
    if (button.dataset.submission) { const record = state.problem.submissions.find(s => s.id === button.dataset.submission); const code = await (await api(`/api/submissions/${record.id}/code`)).text(); showSnapshot({ ...record, code }); }
  };
  action().catch(error => notice(error.message, true));
});
document.addEventListener('keydown', e => { if (!(e.metaKey || e.ctrlKey) || !state.problem || document.querySelector('dialog[open]')) return; if (e.key === 's' && !$('solution-tab').hidden) { e.preventDefault(); saveCode().catch(error => notice(error.message, true)); } if (e.key === 'Enter') { e.preventDefault(); runTests().catch(error => notice(error.message, true)); } });
window.addEventListener('beforeunload', e => { if (dirty() || testsDirty()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', syncEditorScroll);
refresh().catch(error => { $('problems').innerHTML = '<p class="muted">Could not load problems. Use Refresh to try again.</p>'; notice(error.message, true); });
