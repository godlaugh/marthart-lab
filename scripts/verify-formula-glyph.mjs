import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,utimes,symlink,unlink} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createFormulaGlyphService,decodeFormulaGlyph} from '../server/formula-glyph.mjs';
import {createExportServer} from '../server/index.mjs';

const {values}=parseArgs({options:{backend:{type:'string'},reference:{type:'string'},out:{type:'string'}}});
for(const key of ['backend','reference','out'])if(!values[key]||!path.isAbsolute(values[key]))throw new Error(`--${key} requires an absolute path`);
const backend=JSON.parse(await readFile(values.backend,'utf8')),reference=JSON.parse(await readFile(values.reference,'utf8'));
assert.equal(reference.schemaVersion,1);assert.equal(reference.format,'straight-rgba8');assert.equal(reference.fontSize,50);assert.equal(reference.cases.length,21);
const inputs=reference.cases;
await mkdir(values.out,{recursive:false});
const start=performance.now(),checks=[],outputs=[];let service;
const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);};
async function running(owner){const deadline=performance.now()+5000;while(owner.processCount===0){if(performance.now()>deadline)throw new Error('No owned JVM started');await new Promise(resolve=>setTimeout(resolve,5));}}
try{
 service=await createFormulaGlyphService(backend);
 for(const input of inputs){
  const actual=await service.render({latex:input.latex,color:input.color});assert.equal(actual.ok,true,JSON.stringify(actual));
  const expected=input;
  const hash=createHash('sha256').update(actual.value.pixels).digest('hex');
  check(input.id+' exact native RGBA',hash===expected.rgbaSha256&&actual.value.width===expected.width&&actual.value.height===expected.height);
  check(input.id+' format identity',actual.value.fontSize===50&&actual.value.format==='straight-rgba8'&&actual.value.rendererIdentity===service.rendererIdentity);
  outputs.push({id:input.id,width:actual.value.width,height:actual.value.height,sha256:hash});
 }
 for(const latex of [String.raw`\includegraphics{/tmp/image.png}`,String.raw`\input{/tmp/document}`,String.raw`\newcommand{\x}{1}\x`,String.raw`\csname input\endcsname`,String.raw`\begin{array}{l}x\end{array}`,'^^5cinput','x%comment','\\'+'a'.repeat(8191)]){
  const result=await service.render({latex,color:'#ffffff'});check('unsupported '+latex.slice(0,80),!result.ok&&result.error.kind==='unsupported');
 }
 for(const input of [{latex:'x',color:'#123456',extra:1},{latex:'\ud800',color:'#ffffff'},{latex:'x',color:'red'},{latex:'x'.repeat(8193),color:'#ffffff'}]){
  const result=await service.render(input);check('invalid request '+checks.length,!result.ok&&result.error.kind==='invalid-input'&&service.processCount===0);
 }
 let result=await service.render({latex:'{x',color:'#ffffff'});check('unbalanced input diagnostic',!result.ok&&result.error.kind==='invalid-input');
 result=await service.render({latex:'x',color:'#ffffff'},{signal:{}});check('invalid cancellation does not reserve',!result.ok&&result.error.kind==='invalid-input'&&service.activeCount===0);
 result=await service.render({latex:'x',color:'#ffffff'},{signal:Object.create(AbortSignal.prototype)});check('unbranded cancellation does not reserve',!result.ok&&result.error.kind==='invalid-input'&&service.activeCount===0);
 result=await service.render({latex:'{'.repeat(65)+'x'+'}'.repeat(65),color:'#ffffff'});check('nesting budget',!result.ok&&result.error.kind==='capacity');
 const first=service.render({latex:'x^2+y^2',color:'#ffffff'});
 result=await service.render({latex:'x',color:'#ffffff'});check('concurrency reservation',!result.ok&&result.error.kind==='capacity');assert.equal((await first).ok,true);
 const abort=new AbortController(),cancelled=service.render({latex:inputs[0].latex,color:'#ffffff'},{signal:abort.signal});
 await running(service);abort.abort();result=await cancelled;check('running cancellation reaps child',!result.ok&&result.error.kind==='cancelled'&&service.processCount===0&&service.activeCount===0);
 check('usable after cancellation',(await service.render({latex:'x',color:'#ffffff'})).ok);
 const closing=service.render({latex:inputs[0].latex,color:'#ffffff'});await running(service);await service.close();result=await closing;
 check('close cancels and drains',!result.ok&&result.error.kind==='cancelled'&&service.activeCount===0&&service.processCount===0);
 result=await service.render({latex:'x',color:'#ffffff'});check('closed service rejects',!result.ok&&result.error.kind==='closed');
 const short=await createFormulaGlyphService({...backend,timeoutMs:1});
 try{result=await short.render({latex:'x',color:'#ffffff'});check('deadline reaps child',!result.ok&&result.error.kind==='timeout'&&short.activeCount===0&&short.processCount===0);}finally{await short.close();}
 const changedHelper=path.join(values.out,'changed-helper.jar');await cp(backend.helperJarPath,changedHelper);
 const stale=await createFormulaGlyphService({...backend,helperJarPath:changedHelper});
 try{await utimes(changedHelper,new Date(),new Date(Date.now()+1000));result=await stale.render({latex:'x',color:'#ffffff'});check('changed backend rejected',!result.ok&&result.error.kind==='unavailable'&&stale.processCount===0);}finally{await stale.close();}
 const valid=Buffer.alloc(20);valid.writeUInt32BE(0x4d414731);valid.writeUInt32BE(1,4);valid.writeUInt32BE(1,8);valid.writeUInt32BE(4,12);valid.set([1,2,3,4],16);
 check('protocol preserves straight RGBA',decodeFormulaGlyph(valid).ok&&decodeFormulaGlyph(valid).value.pixels.equals(Buffer.from([1,2,3,4])));
 for(const bytes of [valid.subarray(0,19),Buffer.concat([valid,Buffer.alloc(1)]),Buffer.alloc(16)])check('malformed protocol '+checks.length,!decodeFormulaGlyph(bytes).ok);
 const huge=Buffer.from(valid);huge.writeUInt32BE(0xffffffff,4);check('expanded raster rejected',!decodeFormulaGlyph(huge).ok);
 const alias=path.join(values.out,'java-alias');await symlink(backend.javaHome,alias);
 const canonical=await createFormulaGlyphService({...backend,javaHome:alias});
 try{await unlink(alias);await symlink(path.join(values.out,'missing-runtime'),alias);check('canonical runtime survives caller symlink retarget',(await canonical.render({latex:'x',color:'#ffffff'})).ok);}finally{await canonical.close();}
 const ambiguous=path.join(values.out,'helper'+path.delimiter+'other.jar');await cp(backend.helperJarPath,ambiguous);
 await assert.rejects(createFormulaGlyphService({...backend,helperJarPath:ambiguous}),/classpath/);checks.push('classpath delimiter rejected before process creation');
 const api=await createExportServer({root:path.join(values.out,'http-exports'),glyphBackend:backend});
 try{
  const address=await api.listen(0),url=`http://127.0.0.1:${address.port}`;
  let response=await fetch(url+'/api/formula-glyph/health');check('HTTP backend advertises exact renderer',(await response.json()).rendererIdentity===service.rendererIdentity);
  response=await fetch(url+'/api/formula-glyph',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({latex:inputs[0].latex,color:inputs[0].color})});
  const bytes=Buffer.from(await response.arrayBuffer());check('HTTP exact glyph transfer',response.status===200&&createHash('sha256').update(bytes).digest('hex')===outputs[0].sha256&&Number(response.headers.get('x-glyph-width'))===outputs[0].width&&Number(response.headers.get('x-glyph-height'))===outputs[0].height&&response.headers.get('x-glyph-format')==='straight-rgba8'&&response.headers.get('x-glyph-renderer')===service.rendererIdentity);
  response=await fetch(url+'/api/formula-glyph',{method:'POST',headers:{'content-type':'application/json',origin:'https://outside.invalid'},body:'{}'});check('HTTP origin guard',response.status===403);await response.arrayBuffer();
  response=await fetch(url+'/api/formula-glyph',{method:'POST',headers:{'content-type':'application/json'},body:Buffer.from([0xff])});check('HTTP invalid UTF-8 rejected',response.status===400);await response.arrayBuffer();
  response=await fetch(url+'/api/formula-glyph',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({latex:String.raw`\includegraphics{x}`,color:'#ffffff'})});check('HTTP unsupported remains tagged',response.status===422&&(await response.json()).kind==='unsupported');
  const disconnect=new AbortController();const pending=fetch(url+'/api/formula-glyph',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({latex:inputs[0].latex,color:'#ffffff'}),signal:disconnect.signal}).catch(error=>error);
  const deadline=performance.now()+5000;while(!api.ownedProcessCount){assert.ok(performance.now()<deadline,'HTTP child starts');await new Promise(resolve=>setTimeout(resolve,5));}disconnect.abort();await pending;
  while(api.ownedProcessCount){assert.ok(performance.now()<deadline,'HTTP child closes');await new Promise(resolve=>setTimeout(resolve,5));}checks.push('HTTP disconnect reaps actual child');
  const shutdown=fetch(url+'/api/formula-glyph',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({latex:inputs[0].latex,color:'#ffffff'})}).then(async r=>({status:r.status,body:await r.text()})).catch(error=>({error:error.name}));
  const stopDeadline=performance.now()+5000;while(!api.ownedProcessCount){assert.ok(performance.now()<stopDeadline);await new Promise(resolve=>setTimeout(resolve,5));}await api.close();await shutdown;check('HTTP close drains glyph ownership',api.ownedProcessCount===0);
 }finally{await api.close();}
 const unconfigured=await createExportServer({root:path.join(values.out,'http-unconfigured')});
 try{const address=await unconfigured.listen(0),url=`http://127.0.0.1:${address.port}`;check('unconfigured availability explicit',(await (await fetch(url+'/api/formula-glyph/health')).json()).available===false);const response=await fetch(url+'/api/formula-glyph',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});check('unconfigured backend does not fall back',response.status===503);await response.arrayBuffer();}finally{await unconfigured.close();}
 const report={status:'passed',checks,outputs,elapsedSeconds:(performance.now()-start)/1000,rendererIdentity:service.rendererIdentity,reference:values.reference,referenceSha256:createHash('sha256').update(await readFile(values.reference)).digest('hex'),limits:['Real helper, local HTTP API and process lifecycle; no browser compositor, PNG or recording claims.','Child lifecycle verifies owner completion; no process-family peak-memory or CPU measurements.']};
 await writeFile(path.join(values.out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:checks.length,exactGlyphs:outputs.length,elapsedSeconds:report.elapsedSeconds}));
}finally{await service?.close();}
