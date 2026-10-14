// DOM interaction regressions, not browser visual/layout tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Prism = require('prismjs/components/prism-core');
require('prismjs/components/prism-clike');
require('prismjs/components/prism-c');

const html=fs.readFileSync('web/index.html','utf8');
const source=fs.readFileSync('web/app.js','utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function problem(id=1480,extra={}) { return {id,title:`Problem ${id}`,difficulty:'Easy',url:`https://leetcode.com/problems/test-${id}/`,manifest:{topics:['Array']},description:'# Description',solutions:[{name:'master'}],runs:[],submissions:[],tests:[{id:'single',input:{nums:[1]},expected:[1]}],testsHash:'tests-hash',...extra}; }
function response(value) { return new Response(typeof value==='string'?value:JSON.stringify(value),{status:200}); }
async function harness(handler=()=>undefined) {
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://127.0.0.1:3089/'}),w=dom.window,calls=[];
  w.marked=marked;w.DOMPurify=createDOMPurify(w);w.confirm=()=>true;w.Prism=Prism;
  w.TextDecoder=TextDecoder;
  w.EventSource=class {
    static instances=[];
    constructor(url){this.url=url;w.EventSource.instances.push(this);}
    close(){this.closed=true;}
    emit(hash){this.onmessage?.({data:JSON.stringify({hash})});}
  };
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async(route,opts={})=>{
    const call={route,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null};calls.push(call);
    const custom=handler(call);if(custom!==undefined)return await custom;
    if(route==='/api/problems')return response([problem()]);
    const match=/^\/api\/problems\/(\d+)$/.exec(route);if(match)return response(problem(Number(match[1])));
    if(route.endsWith('/solutions/master'))return response({code:'initial',hash:'source-hash'});
    throw new Error(`Unexpected request ${call.method} ${route}`);
  };
  w.eval(source+'\nwindow.hooks={state,dirty,testsDirty,loadProblem,saveCode,saveTests,runTests,showReport,showLog,highlightCode,refreshExternalCode};');
  await pause();await w.hooks.loadProblem(1480);
  return {w,calls,$:id=>w.document.getElementById(id),close:()=>w.close()};
}

test('saving code acknowledges the submitted text, preserving newer typing',async()=>{
  const ack=deferred();const h=await harness(call=>call.method==='PUT'&&call.route.includes('/solutions/')?ack.promise:undefined);
  h.$('code').value='submitted';const saving=h.w.hooks.saveCode();
  h.$('code').value='newer edit';ack.resolve(response({hash:'submitted-hash'}));await saving;
  assert.equal(h.w.hooks.state.savedCode,'submitted');assert.equal(h.w.hooks.dirty(),true);
  assert.equal(h.$('code').value,'newer edit');assert.equal(h.$('saved-state').textContent,'Unsaved changes');h.close();
});
test('saving tests acknowledges the submitted JSON, preserving newer edits',async()=>{
  const ack=deferred();const h=await harness(call=>call.method==='PUT'&&call.route.endsWith('/tests')?ack.promise:undefined);
  const sent='[{"id":"sent","input":{},"expected":1}]';h.$('tests-json').value=sent;
  const saving=h.w.hooks.saveTests();h.$('tests-json').value='[{"id":"newer","input":{},"expected":2}]';
  ack.resolve(response({hash:'saved-tests'}));await saving;
  assert.equal(h.w.hooks.state.savedTests,sent);assert.equal(h.w.hooks.testsDirty(),true);h.close();
});
test('rapid run calls cannot overlap while the first save is pending',async()=>{
  const ack=deferred();const h=await harness(call=>{
    if(call.method==='PUT')return ack.promise;
    if(call.route.endsWith('/run'))return response(JSON.stringify({type:'done',run:{id:'run1',problemId:1480,solution:'master',sourceHash:'saved-hash',testsHash:'tests-hash',status:'passed',passed:1,total:1,durationMs:5,cases:[],leakCheck:'unavailable'}})+'\n');
  });
  h.$('code').value='submitted';const first=h.w.hooks.runTests();await h.w.hooks.runTests();
  ack.resolve(response({hash:'saved-hash'}));await first;
  assert.equal(h.calls.filter(c=>c.route.endsWith('/run')).length,1);assert.equal(h.w.hooks.state.running,false);h.close();
});
test('unsaved testcase edits block a run with recovery text',async()=>{
  const h=await harness();h.$('tests-json').value='[]';await h.w.hooks.runTests();
  assert.equal(h.calls.filter(c=>c.route.endsWith('/run')).length,0);assert.match(h.$('notice').textContent,/Save your test case/);h.close();
});
test('keyboard users can leave the editor with Shift Tab or Escape',async()=>{
  const h=await harness();h.$('code').focus();
  const tab=new h.w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});h.$('code').dispatchEvent(tab);
  assert.equal(tab.defaultPrevented,false);
  h.$('code').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(h.w.document.activeElement,h.$('save-code'));h.close();
});
test('case names live and compile retain their own log channels',async()=>{
  const h=await harness(call=>call.route.includes('/logs?')?response('case log'):undefined);
  h.w.hooks.showReport({id:'run1',problemId:1480,solution:'master',sourceHash:'source-hash',testsHash:'tests-hash',status:'failed',passed:0,total:1,durationMs:1,cases:[{id:'compile',status:'wrong_answer',durationMs:1}],leakCheck:'unavailable'});
  h.$('log-source').value='case:compile';await h.w.hooks.showLog();
  assert.ok(h.calls.some(c=>c.route.includes('case=compile')));assert.equal(h.$('log').textContent,'case log');h.close();
});
test('missing solution error releases the navigation lock',async()=>{
  const h=await harness(call=>call.route==='/api/problems/999'?response(problem(999,{solutions:[]})):undefined);
  await assert.rejects(h.w.hooks.loadProblem(999),/No solution/);
  assert.equal(h.w.hooks.state.loading,false);await h.w.hooks.loadProblem(1480);assert.equal(h.w.hooks.state.problem.id,1480);h.close();
});
test('a slow history response cannot overwrite the newly selected problem',async()=>{
  const ack=deferred();const h=await harness(call=>call.route==='/api/runs/old-run'?ack.promise:undefined);
  const button=h.w.document.createElement('button');button.dataset.run='old-run';h.w.document.body.append(button);button.click();
  await h.w.hooks.loadProblem(589);
  ack.resolve(response({id:'old-run',problemId:1480,solution:'master',cases:[]}));await pause();await pause();
  assert.equal(h.w.hooks.state.problem.id,589);assert.equal(h.w.hooks.state.report,null);h.close();
});
test('failed source loading preserves the previous problem and editor together',async()=>{
  const h=await harness(call=>call.route==='/api/problems/589/solutions/master'?new Response(JSON.stringify({error:'Source unavailable'}),{status:404}):undefined);
  await assert.rejects(h.w.hooks.loadProblem(589),/Source unavailable/);
  assert.equal(h.w.hooks.state.problem.id,1480);assert.equal(h.$('code').value,'initial');assert.equal(h.w.hooks.state.loading,false);h.close();
});
test('import navigation is blocked during an active run',async()=>{
  const h=await harness();h.w.hooks.state.running=true;h.$('import-btn').click();await pause();
  assert.equal(h.$('import-dialog').hasAttribute('open'),false);h.close();
});
test('C highlighting preserves editable source, final newlines and safe HTML',async()=>{
  const h=await harness();
  const code='#include <stdio.h>\n// </code><script>bad()</script>\nint main(void) { printf("Hello"); return 42; }\n';
  h.$('code').value=code;h.$('code').dispatchEvent(new h.w.Event('input',{bubbles:true}));
  assert.equal(h.$('code').value,code);
  assert.equal(h.$('highlight-code').textContent,code+' ');
  assert.ok(h.$('highlight-code').querySelector('.token.keyword'));
  assert.ok(h.$('highlight-code').querySelector('.token.comment'));
  assert.ok(h.$('highlight-code').querySelector('.token.string'));
  assert.ok(h.$('highlight-code').querySelector('.token.number'));
  assert.equal(h.$('highlight-code').querySelector('script'),null);
  assert.equal(h.$('highlight').getAttribute('aria-hidden'),'true');
  assert.equal(h.$('source-surface').classList.contains('highlighted'),true);h.close();
});
test('highlight and gutter follow both scroll axes without clamping text',async()=>{
  const h=await harness();const editor=h.$('code');
  Object.defineProperty(editor,'clientHeight',{value:240});
  editor.scrollLeft=80;editor.scrollTop=210;editor.dispatchEvent(new h.w.Event('scroll'));
  assert.equal(h.$('highlight-code').style.transform,'translate(-80px, -210px)');
  assert.equal(h.$('line-numbers').scrollTop,210);
  assert.equal(h.$('line-numbers').style.height,'240px');h.close();
});
test('missing highlighter retains the readable textarea fallback',async()=>{
  const h=await harness();h.w.Prism=undefined;h.w.hooks.highlightCode();
  assert.equal(h.$('source-surface').classList.contains('highlighted'),false);
  assert.equal(h.$('code').value,'initial');h.close();
});
test('Tab insertion refreshes tokens and saving uses exact textarea source',async()=>{
  const h=await harness(call=>call.method==='PUT'?response({hash:'saved'}):undefined);
  h.$('code').value='int x = 42;';h.$('code').setSelectionRange(0,0);
  h.$('code').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(h.$('code').value,'    int x = 42;');
  assert.equal(h.$('highlight-code').textContent,h.$('code').value);
  await h.w.hooks.saveCode();
  assert.equal(h.calls.find(c=>c.method==='PUT').body.code,'    int x = 42;');h.close();
});

test('disk change events update a clean editor and close the previous subscription',async()=>{
  let disk={code:'initial',hash:'source-hash'};
  const h=await harness(call=>call.route.endsWith('/solutions/master')?response(disk):undefined);
  const stream=h.w.EventSource.instances.at(-1);
  assert.equal(stream.url,'/api/problems/1480/solutions/master/events');
  disk={code:'int updated;\n',hash:'disk-hash'};stream.emit('disk-hash');
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(h.$('code').value,disk.code);assert.equal(h.w.hooks.state.sourceHash,'disk-hash');
  assert.equal(h.w.hooks.dirty(),false);assert.match(h.$('notice').textContent,/updated from disk/);
  await h.w.hooks.loadProblem(589);assert.equal(stream.closed,true);h.close();
});
test('external changes preserve unsaved browser edits and their original CAS hash',async()=>{
  let disk={code:'initial',hash:'source-hash'};
  const h=await harness(call=>call.route.endsWith('/solutions/master')?response(disk):undefined);
  h.$('code').value='my unsaved changes';disk={code:'external',hash:'disk-hash'};
  await h.w.hooks.refreshExternalCode();
  assert.equal(h.$('code').value,'my unsaved changes');assert.equal(h.w.hooks.state.sourceHash,'source-hash');
  assert.match(h.$('saved-state').textContent,/Changed on disk/);
  assert.match(h.$('notice').textContent,/preserved/);h.close();
});
test('typing during an external refresh and navigation both reject stale source responses',async()=>{
  let pending;const h=await harness(call=>pending&&call.route==='/api/problems/1480/solutions/master'?pending.promise:undefined);
  pending=deferred();let refresh=h.w.hooks.refreshExternalCode();h.$('code').value='typed while fetching';
  pending.resolve(response({code:'external',hash:'disk-hash'}));await refresh;
  assert.equal(h.$('code').value,'typed while fetching');
  h.$('code').value='initial';pending=deferred();refresh=h.w.hooks.refreshExternalCode();
  await h.w.hooks.loadProblem(589);pending.resolve(response({code:'old problem',hash:'stale'}));await refresh;
  assert.equal(h.w.hooks.state.problem.id,589);assert.equal(h.$('code').value,'initial');h.close();
});
