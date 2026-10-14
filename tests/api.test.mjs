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
  assert.equal((await fetch(base+'/api/tags')).status,401);
  assert.equal((await fetch(base+'/api/problems/1480/solutions/master/events')).status,401);
  assert.equal((await request('/api/health')).status,200);
  for(const file of ['/','/app.js','/style.css','/utilities.css','/vendor/bootstrap.css','/vendor/marked.js','/vendor/purify.js','/vendor/prism-core.js','/vendor/prism-clike.js','/vendor/prism-c.js']) assert.equal((await request(file)).status,200,file);
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
test('problem import is atomic and rejects unconfirmed duplicate IDs',async()=>{
  const dir=path.join(root,'examples/1480');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));manifest.id=999;
  const files=Object.fromEntries(['main.c','solution.h','solution-master.c'].map(name=>[name,fs.readFileSync(path.join(dir,name),'utf8')]));
  const bundle={manifest,description:'# Imported problem',files,tests:[{id:'single',input:{nums:[1]},expected:[1]}]};
  assert.equal((await request('/api/problems','POST',{...bundle,files:{...files,'../secret.c':'bad'}})).status,400);
  assert.equal(fs.existsSync(path.join(data,'problems/999')),false);
  assert.equal((await request('/api/problems','POST',bundle)).status,201);
  assert.equal((await request('/api/problems','POST',bundle)).status,409);
  const imported=fs.readFileSync(path.join(data,'problems/999/solution-master.c'),'utf8');
  assert.ok(imported.startsWith(fs.readFileSync('templates/solution-preamble.c','utf8')));
  assert.ok(imported.endsWith(files['solution-master.c']));
  const again={...bundle,manifest:{...manifest,id:998},files:{...files,'solution-master.c':imported}};
  assert.equal((await request('/api/problems','POST',again)).status,201);
  assert.equal(fs.readFileSync(path.join(data,'problems/998/solution-master.c'),'utf8'),imported);
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

test('source events survive atomic replacement, repeated saves, deletion and recreation',async()=>{
  await request('/api/problems/1480/solutions','POST',{name:'live'});
  const file=path.join(data,'problems/1480/solution-live.c');
  const controller=new AbortController();
  const response=await fetch(base+'/api/problems/1480/solutions/live/events',{headers:{Authorization:auth},signal:controller.signal});
  assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader();let pending='';
  async function next(){
    const deadline=AbortSignal.timeout(4000);
    while(true){
      const split=pending.indexOf('\n\n');
      if(split>=0){const frame=pending.slice(0,split);pending=pending.slice(split+2);if(frame.startsWith('data: '))return JSON.parse(frame.slice(6));continue;}
      const chunk=await Promise.race([reader.read(),new Promise((_,reject)=>deadline.addEventListener('abort',()=>reject(new Error('SSE timeout')),{once:true}))]);
      assert.equal(chunk.done,false);pending+=new TextDecoder().decode(chunk.value);
    }
  }
  try {
    assert.ok((await next()).hash);
    fs.writeFileSync(file+'.tmp','/* atomic replacement */');fs.renameSync(file+'.tmp',file);
    const first=await next();assert.ok(first.hash);
    fs.writeFileSync(file,'/* second save */');const second=await next();assert.notEqual(second.hash,first.hash);
    fs.unlinkSync(file);assert.equal((await next()).hash,null);
    fs.writeFileSync(file,'/* restored */');assert.ok((await next()).hash);
  } finally {controller.abort();await reader.cancel().catch(()=>{});}
});

test('confirmed overwrite backs up all variants, checks disk changes and preserves history',async()=>{
  const bundle=JSON.parse(fs.readFileSync('bundles/problem-94.json','utf8'));
  bundle.manifest.id=999;
  await request('/api/problems/999/solutions','POST',{name:'personal'});
  const oldFile=path.join(data,'problems/999/solution-personal.c');
  fs.writeFileSync(oldFile,'/* personal solution */');
  const runId='b'.repeat(32), submissionId='c'.repeat(32);
  await db.run.create({data:{id:runId,problemId:999,solution:'personal',sourceHash:'old',buildHash:'old',contextHash:'old',status:'passed',passed:1,total:1,durationMs:1,startedAt:new Date()}});
  await db.submission.create({data:{id:submissionId,problemId:999,solution:'personal',sourceHash:'old',commitSha:'fixture',runId}});
  const duplicate=await request('/api/problems','POST',bundle);
  assert.equal(duplicate.status,409);const conflict=await duplicate.json();
  assert.equal(conflict.code,'problem_exists');assert.ok(conflict.expectedHash);
  assert.equal((await request('/api/problems','POST',{...bundle,overwrite:true})).status,428);
  fs.writeFileSync(oldFile,'/* modified after confirmation */');
  assert.equal((await request('/api/problems','POST',{...bundle,overwrite:true,expectedHash:conflict.expectedHash})).status,409);
  const latest=await(await request('/api/problems','POST',bundle)).json();
  assert.equal((await request('/api/problems','POST',{...bundle,overwrite:true,expectedHash:latest.expectedHash,files:{...bundle.files,'bad.txt':'invalid'}})).status,400);
  assert.equal(fs.readFileSync(oldFile,'utf8'),'/* modified after confirmation */');
  const result=await request('/api/problems','POST',{...bundle,overwrite:true,expectedHash:latest.expectedHash});
  assert.equal(result.status,200);const imported=await result.json();assert.equal(imported.overwritten,true);
  assert.equal(fs.readFileSync(path.join(data,imported.backupPath,'solution-personal.c'),'utf8'),'/* modified after confirmation */');
  assert.equal(fs.existsSync(oldFile),false);
  assert.equal(await db.solution.count({where:{problemId:999,name:'personal'}}),0);
  assert.equal(await db.run.count({where:{id:runId}}),1);assert.equal(await db.submission.count({where:{id:submissionId}}),1);
  const description=fs.readFileSync(path.join(data,'problems/999/description.md'),'utf8');
  assert.match(description,/!\[.*\]\(https:\/\/assets.leetcode.com\/uploads\/2024\/08\/29\/tree_2.png\)/);
});

test('failed replacement installation restores the original problem directory',async()=>{
  const {importBundle}=await import('../server/workspace.mjs');
  const bundle=JSON.parse(fs.readFileSync('bundles/problem-94.json','utf8'));bundle.manifest.id=997;
  importBundle(bundle);const file=path.join(data,'problems/997/solution-master.c');
  fs.writeFileSync(file,'/* preserve after failed installation */');
  let expectedHash;try {importBundle(bundle);} catch(error){expectedHash=error.details.expectedHash;}
  const rename=fs.renameSync;
  try {
    fs.renameSync=(from,to)=>{if(path.basename(from).startsWith('.import-')&&to===path.dirname(file))throw new Error('Simulated installation failure');return rename(from,to);};
    assert.throws(()=>importBundle({...bundle,overwrite:true,expectedHash}),/Simulated installation failure/);
  } finally {fs.renameSync=rename;}
  assert.equal(fs.readFileSync(file,'utf8'),'/* preserve after failed installation */');
});

test('appending a testcase validates it and preserves every previous case with CAS',async()=>{
  const dir=path.join(data,'problems/94/tests.json'),before=fs.readFileSync(dir,'utf8');
  const problem=await(await request('/api/problems/94')).json();
  const testCase={id:'leetcode-large',input:{root:Array.from({length:5001},(_,i)=>i)},expected:[]};
  assert.equal((await request('/api/problems/94/tests','POST',{test:testCase,expectedHash:'stale'})).status,409);
  assert.equal(fs.readFileSync(dir,'utf8'),before);
  const result=await request('/api/problems/94/tests','POST',{test:testCase,expectedHash:problem.testsHash});assert.equal(result.status,201);
  const ack=await result.json(),tests=JSON.parse(fs.readFileSync(dir,'utf8'));assert.deepEqual(tests.slice(0,-1),problem.tests);
  assert.equal(tests.at(-1).input.root.length,5001);
  assert.equal((await request('/api/problems/94/tests','POST',{test:testCase,expectedHash:ack.hash})).status,400);
  assert.deepEqual(JSON.parse(fs.readFileSync(dir,'utf8')),tests);
});

test('accepted status is manual, persistent across indexing, and filterable with tags and search',async()=>{
  assert.equal((await request('/api/problems/94','PATCH',{accepted:'true'})).status,400);
  assert.equal((await request('/api/problems/94','PATCH',{accepted:true},{Origin:'https://other.example'})).status,403);
  assert.equal((await request('/api/problems/94','PATCH',{accepted:true})).status,200);
  const current=await(await request('/api/problems/94')).json();assert.equal(current.accepted,true);
  const filtered=await(await request('/api/problems?q=94&accepted=true&tags=Tree&tags=Stack')).json();
  assert.deepEqual(filtered.map(p=>p.id),[94]);assert.ok(filtered[0].tags.some(t=>t.name==='Tree'));
  const none=await(await request('/api/problems?q=94&accepted=false')).json();assert.deepEqual(none,[]);
  const treeStack=await(await request('/api/problems?tags=Tree&tags=Stack')).json();
  assert.ok(treeStack.some(p=>p.id===94));assert.ok(!treeStack.some(p=>p.id===783));
  assert.ok(treeStack.every(p=>['Tree','Stack'].every(name=>p.tags.some(tag=>tag.name===name))));
  assert.deepEqual(await(await request('/api/problems?tags=unknown-topic')).json(),[]);
  assert.equal((await request('/api/problems?accepted=yes')).status,400);
  assert.equal((await request('/api/problems?tags=')).status,400);
  assert.equal((await request('/api/problems?q=a&q=b')).status,400);
  assert.equal((await request('/api/problems/94','PATCH',{accepted:false})).status,200);
  assert.equal((await(await request('/api/problems/94')).json()).accepted,false);
});
test('normalized topic tags have unique indexed joins and are refreshed on overwrite without clearing accepted',async()=>{
  const bundle=JSON.parse(fs.readFileSync('bundles/problem-94.json','utf8'));bundle.manifest.id=996;
  bundle.manifest.topics=['Tree',' Tree ','Stack','','Tree'];
  assert.equal((await request('/api/problems','POST',bundle)).status,201);
  let problem=await(await request('/api/problems/996')).json();
  assert.deepEqual(problem.tags.map(tag=>tag.name).sort(),['Stack','Tree']);
  assert.equal(await db.problemTag.count({where:{problemId:996}}),2);
  await request('/api/problems/996','PATCH',{accepted:true});
  bundle.manifest.topics=['New Topic'];
  const conflict=await(await request('/api/problems','POST',bundle)).json();
  assert.equal((await request('/api/problems','POST',{...bundle,overwrite:true,expectedHash:conflict.expectedHash})).status,200);
  problem=await(await request('/api/problems/996')).json();assert.equal(problem.accepted,true);
  assert.deepEqual(problem.tags.map(tag=>tag.name),['New Topic']);
  assert.deepEqual(await(await request('/api/problems?q=996&tags=Tree')).json(),[]);
  const tags=await(await request('/api/tags')).json();
  assert.ok(tags.find(tag=>tag.name==='New Topic'&&tag.count===1));assert.equal(tags.filter(tag=>tag.name==='Tree').length,1);
  const indexes=await db.$queryRawUnsafe('PRAGMA index_list("ProblemTag")');
  assert.ok(indexes.some(index=>index.name==='ProblemTag_tagId_problemId_idx'));
  assert.ok((await db.$queryRawUnsafe('PRAGMA index_list("Problem")')).some(index=>index.name==='Problem_accepted_id_idx'));
  const tag=await db.tag.findUnique({where:{name:'Tree'}});
  await assert.rejects(db.problemTag.create({data:{problemId:94,tagId:tag.id}}));
});

function problemZip(entries) {
  return execFileSync('python3',['-c',`import io,json,sys,zipfile
stream=io.BytesIO()
with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
    for filename,data in json.load(sys.stdin): archive.writestr(filename,json.dumps(data))
sys.stdout.buffer.write(stream.getvalue())`],{input:JSON.stringify(entries),maxBuffer:40*1024*1024});
}
async function previewZip(bytes) {
  return fetch(base+'/api/imports/preview',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/zip'},body:bytes});
}
function zipBundle(id) { const bundle=JSON.parse(fs.readFileSync('bundles/problem-94.json','utf8'));bundle.manifest.id=id;return bundle; }

test('ZIP preview validates every bundle before writes and batch commits only once',async()=>{
  const good=zipBundle(9901),bad=zipBundle(9902);delete bad.files['main.c'];
  assert.equal((await previewZip(problemZip([['problem-9901.json',good],['problem-9902.json',bad]]))).status,400);
  assert.equal(fs.existsSync(path.join(data,'problems/9901')),false);
  good.overwrite=true;
  assert.equal((await previewZip(problemZip([['problem-9901.json',good]]))).status,400);delete good.overwrite;
  const preview=await previewZip(problemZip([['problem-9901.json',good],['folder/problem.json',zipBundle(9902)]]));
  assert.equal(preview.status,200);const job=await preview.json();assert.equal(job.problems.length,2);
  assert.equal(fs.existsSync(path.join(data,'problems/9901')),false);
  const body={token:job.token,items:job.problems.map(problem=>({id:problem.id,action:'import'}))};
  const result=await request('/api/imports/commit','POST',body);assert.equal(result.status,200);
  assert.deepEqual((await result.json()).results.map(item=>item.status),['imported','imported']);
  assert.equal((await request('/api/imports/commit','POST',body)).status,410);
  assert.equal(await db.problem.count({where:{id:{in:[9901,9902]}}}),2);
});
test('ZIP duplicate choices require confirmation, preserve accepted and reject stale previews',async()=>{
  await request('/api/problems/94','PATCH',{accepted:true});
  const zip=problemZip([['problem-94.json',zipBundle(94)],['problem-9903.json',zipBundle(9903)],['_collection.json',{included:[94,9903],unavailable:[{slug:'premium-fixture',reason:'Official C starter unavailable'}],complete:false}]]);
  let job=await(await previewZip(zip)).json();assert.equal(job.problems[0].existing,true);
  assert.equal(job.collectionReport.unavailable.length,1);
  const choices=[{id:94,action:'overwrite'},{id:9903,action:'import'}];
  assert.equal((await request('/api/imports/commit','POST',{token:job.token,items:choices})).status,428);
  const oldFile=path.join(data,'problems/94/solution-master.c');fs.writeFileSync(oldFile,'/* changed after preview */');
  assert.equal((await request('/api/imports/commit','POST',{token:job.token,items:choices,confirmedOverwrite:true})).status,409);
  assert.equal(fs.existsSync(path.join(data,'problems/9903')),false);
  job=await(await previewZip(zip)).json();
  const result=await(await request('/api/imports/commit','POST',{token:job.token,items:choices,confirmedOverwrite:true})).json();
  assert.equal(result.results[0].overwritten,true);assert.equal(result.results[1].status,'imported');
  assert.equal(fs.readFileSync(path.join(data,result.results[0].backupPath,'solution-master.c'),'utf8'),'/* changed after preview */');
  assert.equal((await db.problem.findUnique({where:{id:94}})).accepted,true);
  job=await(await previewZip(zip)).json();
  const skipped=await(await request('/api/imports/commit','POST',{token:job.token,items:job.problems.map(problem=>({id:problem.id,action:'skip'}))})).json();
  assert.ok(skipped.results.every(item=>item.status==='skipped'));
});
test('batch expiration, active runs and partial filesystem failures have explicit outcomes',async()=>{
  const {createBatchImports}=await import('../server/batch-import.mjs');const active=new Set();
  const service=createBatchImports({python:'python3',active,syncProblem:async()=>{}});
  const zip=problemZip([['problem-9904.json',zipBundle(9904)],['problem-9905.json',zipBundle(9905)]]);
  try {
    let job=await service.preview(zip);const originalNow=Date.now;
    try {Date.now=()=>originalNow()+11*60*1000;await assert.rejects(service.commit({token:job.token}),error=>error.status===410);}finally{Date.now=originalNow;}
    job=await service.preview(zip);const items=job.problems.map(problem=>({id:problem.id,action:'import'}));
    active.add('9904/master');await assert.rejects(service.commit({token:job.token,items}),error=>error.status===409);active.clear();
    const rename=fs.renameSync;let result;
    try {fs.renameSync=(from,to)=>{if(to===path.join(data,'problems/9905'))throw new Error('Simulated batch installation failure');return rename(from,to);};result=await service.commit({token:job.token,items});}finally{fs.renameSync=rename;}
    assert.deepEqual(result.results.map(item=>item.status),['imported','failed']);assert.equal(fs.existsSync(path.join(data,'problems/9904')),true);assert.equal(fs.existsSync(path.join(data,'problems/9905')),false);
  } finally {service.close();}
});
