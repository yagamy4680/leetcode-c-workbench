import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseTree, treeKind, treeDot, visualizeTree, renderTreeSvg } from '../server/tree-visualization.mjs';

const binary = { signature: 'int findSecondMinimumValue(struct TreeNode* root);' };
const nary = { signature: 'int* postorder(struct Node* root, int* returnSize);', headers: ['wb_nary_types.h'] };
const chain = count => [0, ...Array.from({ length: count - 1 }, (_, i) => [null, i + 1]).flat()];

test('binary input uses queue serialization, unique node IDs and correct duplicate edges', () => {
  const tree = parseTree({ root: [2,2,5,null,null,5,7] }, 'binary');
  assert.equal(tree.height, 3); assert.equal(tree.nodes.length, 5);
  assert.deepEqual(tree.nodes.map(node => node.value), [2,2,5,5,7]);
  assert.deepEqual(tree.nodes[0].children, [1,2]);
  assert.deepEqual(tree.nodes[2].children, [3,4]);
  const dot = treeDot(tree, 'binary');
  assert.match(dot, /n2 -> n3 \[label="L"\]/); assert.match(dot, /n2 -> n4 \[label="R"\]/);
  const rightOnly = treeDot(parseTree({ root: [1,null,2] }, 'binary'), 'binary');
  assert.ok(rightOnly.indexOf('n0 -> gap0_0') < rightOnly.indexOf('n0 -> n1'));
  assert.match(rightOnly, /gap0_0 -> n1 \[style=invis/);
});

test('N-ary null-separated groups retain sibling order and empty child groups', () => {
  assert.equal(treeKind(nary), 'nary'); assert.equal(treeKind(binary), 'binary');
  assert.throws(() => treeKind({ signature: 'struct Node* cloneGraph(struct Node* node);' }), /format is unknown/);
  assert.equal(treeKind({}, 'binary'), 'binary');
  const tree = parseTree({ root: [1,null,2,3,4,null,null,5] }, 'nary');
  assert.equal(tree.height, 3); assert.deepEqual(tree.nodes[0].children, [1,2,3]);
  assert.deepEqual(tree.nodes[1].children, []); assert.deepEqual(tree.nodes[2].children, [4]);
});

test('eight levels render inline; nine levels never invoke Graphviz until explicit SVG download', async () => {
  let renders = 0; const renderer = async () => { ++renders; return '<svg/>'; };
  for (const levels of [7,8]) {
    const result = await visualizeTree(binary, { input: { root: chain(levels) } }, renderer);
    assert.equal(result.height, levels); assert.equal(result.inline, true); assert.equal(result.svg, '<svg/>');
  }
  const deep = await visualizeTree(binary, { input: { root: chain(5001) } }, renderer);
  assert.equal(deep.height, 5001); assert.equal(deep.svg, null); assert.equal(deep.inline, false); assert.equal(renders, 2);
  await visualizeTree(binary, { input: { root: chain(9) }, format: 'svg' }, renderer);
  assert.equal(renders, 3);
  const wide = await visualizeTree(nary, { input: { root: [0,null,...Array(1000).fill(1)] } }, renderer);
  assert.equal(wide.height, 2); assert.equal(wide.inline, false); assert.equal(renders, 3);
});

test('malformed inputs are rejected while empty trees and integer limits remain usable', async () => {
  for (const [input,kind] of [[{},'binary'],[{root:'[1]'},'binary'],[{root:[1,null,null,2]},'binary'],[{root:[null,1]},'binary'],[{root:[1,2]},'nary'],[{root:[1,null,null,2]},'nary'],[{root:['<script>']},'binary'],[{root:[true]},'binary'],[{root:[2147483648]},'binary']]) assert.throws(() => parseTree(input,kind));
  assert.equal(parseTree({ root: [] }, 'binary').height, 0);
  assert.equal(parseTree({ root: null }, 'nary').height, 0);
  assert.equal(parseTree({ root: [-2147483648,null,2147483647] }, 'binary').height, 2);
  assert.throws(() => parseTree({ root: Array(200002).fill(null) }, 'binary'), /200001/);
  const missing = await visualizeTree(binary, { input: { root: [1] } }, async () => { throw Error('Graphviz unavailable'); });
  assert.equal(missing.nodeCount, 1); assert.equal(missing.renderError, 'Graphviz unavailable');
  const dot = await visualizeTree(binary, { input: { root: [1] }, format: 'dot' }, async () => { throw Error('must not render'); });
  assert.match(dot, /digraph InputTree/);
  await assert.rejects(renderTreeSvg('digraph {}', '/does-not-exist/wb-dot'), /brew install graphviz/);
});

test('native Graphviz produces downloadable SVG from generated DOT', { skip: spawnSync('dot',['-V']).error?.code === 'ENOENT' ? 'Graphviz is optional and is not installed on this host.' : false }, async () => {
  const svg = await visualizeTree(binary, { input: { root: [2,2,5,null,null,5,7] }, format: 'svg' });
  assert.match(svg, /<svg/); assert.match(svg, /n2&#45;&gt;n3/); assert.match(svg, />7<\/text>/);
});
