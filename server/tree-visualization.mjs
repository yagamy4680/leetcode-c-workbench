import { spawn } from 'node:child_process';
import { HttpError } from './workspace.mjs';

export const INLINE_LEVELS = 16;
export const INLINE_NODES = 512;
export const MAX_TREE_NODES = 100000;
export function treeKind(manifest, requested = 'auto') {
  if (requested === 'binary' || requested === 'nary') return requested;
  if (requested !== 'auto') throw new HttpError(400, 'Choose Auto, Binary tree or N-ary tree.');
  if (/\bTreeNode\b/.test(manifest.signature ?? '')) return 'binary';
  const headers = manifest.headers ?? [];
  if (headers.some(header => /^wb_nary(?:_types)?\.h$/.test(header))) return 'nary';
  if (headers.some(header => /^wb_tree(?:_types)?\.h$/.test(header))) return 'binary';
  throw new HttpError(400, 'Tree format is unknown. Choose Binary tree or N-ary tree.', { code: 'tree_format_unknown' });
}

export function parseTree(input, kind) {
  if (!input || !Object.hasOwn(input, 'root')) throw new HttpError(400, 'This case has no root field. Tree diagrams need an input.root array.');
  const values = input.root === null ? [] : input.root;
  if (!Array.isArray(values)) throw new HttpError(400, 'input.root must be an array or null.');
  if (values.length > 2 * MAX_TREE_NODES + 1) throw new HttpError(400, 'Tree input exceeds 200001 serialized entries. Download or inspect the test JSON instead.');
  if (values.some(value => value !== null && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647))) throw new HttpError(400, 'Tree values must be signed 32-bit integers or null.');
  const nodes = [];
  const add = (value, depth) => {
    if (nodes.length >= MAX_TREE_NODES) throw new HttpError(400, 'Tree diagrams support at most 100000 nodes.');
    const node = { id: nodes.length, value, depth, children: [] }; nodes.push(node); return node;
  };
  if (!values.length) return { nodes, height: 0 };
  if (values[0] === null) {
    if (kind === 'nary' ? values.length !== 1 : values.some(value => value !== null)) throw new HttpError(400, 'Tree has data after a null root.');
    return { nodes, height: 0 };
  }
  add(values[0], 1);
  let at = 1, parent = 0, height = 1;
  if (kind === 'nary' && at < values.length && values[at++] !== null) throw new HttpError(400, 'N-ary root must be followed by a null separator.');
  while (at < values.length && parent < nodes.length) {
    const node = nodes[parent++];
    if (kind === 'binary') {
      for (let side = 0; side < 2 && at < values.length; ++side) {
        const value = values[at++];
        if (value === null) { node.children[side] = null; continue; }
        const child = add(value, node.depth + 1); node.children[side] = child.id; height = child.depth;
      }
    } else {
      while (at < values.length && values[at] !== null) {
        const child = add(values[at++], node.depth + 1); node.children.push(child.id); height = child.depth;
      }
      if (at < values.length) ++at;
    }
  }
  if (at < values.length && (kind === 'nary' || values.slice(at).some(value => value !== null))) throw new HttpError(400, 'Tree contains unreachable nodes or child groups.');
  return { nodes, height };
}

export function treeDot(tree, kind) {
  const lines = ['digraph InputTree {', '  graph [ordering=out, bgcolor="transparent", ranksep=0.45, nodesep=0.2];', '  node [shape=ellipse, fontname="Arial", fontsize=12, style=filled, fillcolor="#e4effa", color="#225cac", fontcolor="#202e3a"];', '  edge [arrowhead=none, color="#536472", fontname="Arial", fontsize=9];'];
  if (!tree.nodes.length) lines.push('  empty [shape=plaintext, style="", label="Empty tree"];');
  for (const node of tree.nodes) {
    lines.push(`  n${node.id} [label="${node.value}"];`);
    if (kind === 'binary' && node.children.some(child => child != null)) {
      for (let side = 0; side < 2; ++side) {
        if (node.children[side] == null) lines.push(`  gap${node.id}_${side} [shape=point, style=invis, width=0];`, `  n${node.id} -> gap${node.id}_${side} [style=invis];`);
        else lines.push(`  n${node.id} -> n${node.children[side]} [label="${side ? 'R' : 'L'}"];`);
      }
      // Explicit rank and order preserve left/right positions for one-child trees.
      const children = [0, 1].map(side => node.children[side] == null ? `gap${node.id}_${side}` : `n${node.children[side]}`);
      lines.push(`  { rank=same; ${children.join('; ')}; }`, `  ${children[0]} -> ${children[1]} [style=invis, weight=10];`);
    } else if (kind === 'nary') node.children.forEach(child => lines.push(`  n${node.id} -> n${child};`));
  }
  lines.push('}'); return lines.join('\n') + '\n';
}

let activeRenders = 0;
export async function renderTreeSvg(dot, executable = process.env.DOT || 'dot') {
  if (activeRenders >= 2) throw new HttpError(503, 'Two tree diagrams are already rendering. Try again shortly.');
  ++activeRenders;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, ['-Tsvg']);
      const chunks = []; let bytes = 0, errors = '', settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new HttpError(503, 'Tree rendering exceeded 15 seconds. Download DOT for rendering outside the workbench.')); }, 15000);
      child.stdin.on('error', () => {});
      child.once('error', error => finish(new HttpError(503, error.code === 'ENOENT' ? 'Graphviz is unavailable. Install it on the Mac with brew install graphviz, then retry. You can still download DOT.' : 'Cannot start Graphviz. Check the DOT executable setting.')));
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) { child.kill('SIGKILL'); finish(new HttpError(503, 'SVG exceeds 16 MiB. Download DOT for rendering outside the workbench.')); } else chunks.push(chunk); });
      child.stderr.on('data', chunk => { errors = (errors + chunk).slice(0, 2000); });
      child.once('close', code => { if (code !== 0) finish(new HttpError(503, 'Graphviz could not render this tree. Download DOT or try a smaller case.' + (errors ? ' ' + errors : ''))); else finish(null, Buffer.concat(chunks).toString('utf8')); });
      child.stdin.end(dot);
    });
  } finally { --activeRenders; }
}

export async function visualizeTree(manifest, body, renderer = renderTreeSvg) {
  const format = body?.format ?? 'preview';
  if (!['preview', 'svg', 'dot'].includes(format)) throw new HttpError(400, 'Diagram format must be preview, svg or dot.');
  const kind = treeKind(manifest, body?.kind ?? 'auto'), tree = parseTree(body?.input, kind);
  if (format === 'dot') return treeDot(tree, kind);
  if (format === 'svg') return renderer(treeDot(tree, kind));
  const preview = { kind, height: tree.height, nodeCount: tree.nodes.length, inline: tree.height <= INLINE_LEVELS && tree.nodes.length <= INLINE_NODES, svg: null };
  if (preview.inline && tree.nodes.length) {
    try { preview.svg = await renderer(treeDot(tree, kind)); } catch (error) { preview.renderError = error.message; }
  }
  return preview;
}
