import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=path.resolve('.');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'wb-api-'));
process.env.WB_DATA_DIR=data;
process.env.WB_USER='test-user';
process.env.WB_PASSWORD='fixture-only-password';
process.env.DATABASE_URL=`file:${path.join(data,'workbench.db')}`;
const auth='Basic '+Buffer.from(`${process.env.WB_USER}:${process.env.WB_PASSWORD}`).toString('base64');
const good='int* runningSum(int* a,int n,int* s) { for(int i=1;i<n;i++)a[i]+=a[i-1]; *s=n; return a; }';
let base,server,close,db;
async function request(route, method='GET', body, headers={}) {
  return fetch(base+route,{method,headers:{Authorization:auth,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
}
before(async()=>{
  execFileSync('python3',['runner/workbench.py','init'],{cwd:root,env:process.env});
  execFileSync('python3',['-c','import sqlite3,sys;sqlite3.connect(sys.argv[1]).close()',path.join(data,'workbench.db')]);
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{cwd:root,env:process.env});
  const {createApp}=await import('../server/index.mjs');
  const app=await createApp(); close=app.close; db=app.db;
  await new Promise(resolve=>{server=app.app.listen(0,'127.0.0.1',resolve);});
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}if(close)await close();fs.rmSync(data,{recursive:true,force:true});});

test('all application endpoints require authentication',async()=>{
  assert.equal((await fetch(base+'/api/problems')).status,401);
  assert.equal((await fetch(base+'/')).status,401);
  assert.equal((await request('/api/health')).status,200);
  for(const file of ['/','/app.js','/style.css','/utilities.css','/vendor/bootstrap.css','/vendor/marked.js','/vendor/purify.js']) assert.equal((await request(file)).status,200,file);
});
test('source edits preserve local changes with compare-and-swap',async()=>{
  const current=await(await request('/api/problems/1480/solutions/master')).json();
  assert.equal((await request('/api/problems/1480/solutions/master','PUT',{code:good})).status,428);
  assert.equal((await request('/api/problems/1480/solutions/master','PUT',{code:good,expectedHash:current.hash})).status,200);
  assert.equal((await request('/api/problems/1480/solutions/master','PUT',{code:'stale',expectedHash:current.hash})).status,409);
  assert.equal(fs.readFileSync(path.join(data,'problems/1480/solution-master.c'),'utf8'),good);
});
test('solution variants and test validation',async()=>{
  assert.equal((await request('/api/problems/1480/solutions','POST',{name:'in-place'})).status,201);
  assert.equal((await request('/api/problems/1480/solutions','POST',{name:'in-place'})).status,409);
  assert.equal((await request('/api/problems/1480/solutions','POST',{name:'../bad'})).status,400);
  const p=await(await request('/api/problems/1480')).json();
  assert.equal((await request('/api/problems/1480/tests','PUT',{tests:[{id:'x'}],expectedHash:p.testsHash})).status,400);
  assert.equal((await request('/api/problems/1480/tests','PUT',{tests:p.tests,expectedHash:'stale'})).status,409);
  assert.equal((await request('/api/problems/1480/tests','PUT',{tests:p.tests,expectedHash:p.testsHash})).status,200);
});
test('browser origin checks block cross-site mutations',async()=>{
  assert.equal((await request('/api/problems/1480/solutions','POST',{name:'blocked'},{Origin:'https://other.example'})).status,403);
  assert.equal((await request('/api/problems/1480/solutions','POST',{name:'blocked'},{'Sec-Fetch-Site':'cross-site'})).status,403);
});
test('problem import is atomic and never overwrites an existing problem',async()=>{
  const dir=path.join(root,'examples/1480');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));manifest.id=999;
  const files=Object.fromEntries(['main.c','solution.h','solution-master.c'].map(name=>[name,fs.readFileSync(path.join(dir,name),'utf8')]));
  const bundle={manifest,description:'# Imported problem',files,tests:[{id:'single',input:{nums:[1]},expected:[1]}]};
  assert.equal((await request('/api/problems','POST',{...bundle,files:{...files,'../secret.c':'bad'}})).status,400);
  assert.equal(fs.existsSync(path.join(data,'problems/999')),false);
  assert.equal((await request('/api/problems','POST',bundle)).status,201);
  assert.equal((await request('/api/problems','POST',bundle)).status,409);
});
test('web runs stream diagnostics and create a persisted report',async()=>{
  const source=await(await request('/api/problems/1480/solutions/master')).json();
  const response=await request('/api/problems/1480/run','POST',{solution:'master',sourceHash:source.hash});
  assert.equal(response.status,200);
  const events=(await response.text()).trim().split('\n').map(JSON.parse);
  const report=events.find(e=>e.type==='done')?.run;
  assert.equal(report?.status,'passed',JSON.stringify(events));
  assert.equal(report.total,5);
  assert.equal(await db.run.count({where:{id:report.id}}),1);
  assert.equal((await request(`/api/runs/${report.id}/source`)).status,200);
  assert.equal((await request(`/api/runs/${report.id}/logs?case=single&stream=stderr`)).status,200);
});
test('submission links exact test context, reads immutable Git code, records outcome',async()=>{
  const source=await(await request('/api/problems/1480/solutions/master')).json();
  const response=await request('/api/problems/1480/submissions','POST',{solution:'master',sourceHash:source.hash});
  assert.equal(response.status,201);
  const snap=await response.json();
  assert.equal(snap.testStatus,'passed');assert.ok(snap.runId);assert.equal(snap.code,good);
  fs.writeFileSync(path.join(data,'snapshots',snap.id,'submission.c'),'tampered local file');
  assert.equal(await(await request(`/api/submissions/${snap.id}/code`)).text(),good);
  assert.equal((await request(`/api/submissions/${snap.id}`,'PATCH',{result:'success',memo:'Accepted'})).status,200);
  const problem=await(await request('/api/problems/1480')).json();
  assert.equal(problem.submissions[0].result,'success');
  const tests=problem.tests;tests.push({id:'later-case',input:{nums:[8]},expected:[8]});
  await request('/api/problems/1480/tests','PUT',{tests,expectedHash:problem.testsHash});
  const next=await(await request('/api/problems/1480/submissions','POST',{solution:'master',sourceHash:source.hash})).json();
  assert.equal(next.testStatus,'untested');assert.equal(next.runId,null);
});
test('CLI results are imported after offline execution and remain idempotent',async()=>{
  execFileSync('python3',['runner/workbench.py','run','1480','master','--case','single'],{cwd:root,env:process.env});
  await new Promise(resolve=>setTimeout(resolve,2200));
  const count=await db.run.count({where:{problemId:1480}});
  assert.equal(count,2);
  await request('/api/problems');await request('/api/problems');
  assert.equal(await db.run.count({where:{problemId:1480}}),count);
});
