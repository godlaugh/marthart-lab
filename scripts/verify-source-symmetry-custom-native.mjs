// Actual CGL fragment-state comparison. Requires a pinned normal VIEW/RUN
// capture; never launches the original app or claims integrated UI parity.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';

const [referenceArg,outArg,mode]=process.argv.slice(2);assert(referenceArg&&outArg&&(mode===undefined||mode==='--retained-owner'),'Supply original-reference-directory new-output-directory [--retained-owner]');
const fixture=mode?'tests/fixtures/source-symmetry-state/runner.m':'tests/fixtures/source-symmetry-custom-native/runner.m';
const reference=resolve(referenceArg),out=resolve(outArg),sha=b=>createHash('sha256').update(b).digest('hex');await mkdir(out,{recursive:false});
const report={status:'running',scope:(mode?'Production retained fragment state + diagnostic input adapter. ':'Production source-fragment producer + diagnostic CGL texture owner. ')+'Complete square state only; no app routing, ink, tone, UI, export or arbitrary shader termination claim.',sourceBefore:{},referenceBefore:{},frames:[]};
const began=performance.now();let vite;
async function pinned(path,group){const b=await readFile(path);group[path]=sha(b);return b;}
async function ref(name){return pinned(reference+'/'+name,report.referenceBefore);}
try{
 for(const p of ['src/engine/sourceSymmetryCustom.ts','src/engine/symmetryCustom.ts','src/scenes/symmetryParameters.ts',fixture,'scripts/verify-source-symmetry-custom-native.mjs',...(await readdir('server/render')).map(p=>'server/render/'+p)].sort())await pinned(p,report.sourceBefore);
 const run=JSON.parse(await ref('run.json')),authorization=JSON.parse(await ref('authorization.json')),complete=JSON.parse(await ref('complete.json')),source=JSON.parse(await ref('source.json')),descriptor=JSON.parse(await ref('descriptor.json'));
 assert.equal(run.status,'observed');assert.equal(run.exit,0);assert.deepEqual(run.processGroupAfter,[]);assert.deepEqual(run.sourceAfter,run.sourceBefore);assert.equal(authorization.VIEW,true);assert.equal(authorization.RUN,true);assert.equal(complete.observed,true);assert.equal(source.type,'SYMMETRY_CHAOS');assert.equal(complete.frames,descriptor.frames.length);
 report.authorization=authorization;report.constructedInput=descriptor.constructedInput===true;
 const before=JSON.parse(await ref('runtime-before.json')),count=Number(before.mobject.batchSize),size=Number(before.mobject.texSize);assert.equal(size,Math.ceil(Math.sqrt(count)));assert(count>0&&count<=1000000);
 const seed=await ref('frame-0/state-initial-level-0.bin');assert.equal(seed.length,size*size*16);assert(seed.subarray(count*16).every(v=>v===0),'Original padding must start at zero');await writeFile(out+'/seed.bin',seed);
 vite=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error'});
 const {prepareSourceSymmetryCustomProgram}=await vite.ssrLoadModule('/src/engine/sourceSymmetryCustom.ts'),{bindSymmetryCustomParameters}=await vite.ssrLoadModule('/src/engine/symmetryCustom.ts');
 const program=prepareSourceSymmetryCustomProgram(source.equation.glsl,Number(before.mobject.runtimeSymmetryDegree));
 const frames=[],originalStates=[];
 for(const frame of descriptor.frames){
  const draws=JSON.parse(await ref(`frame-${frame.index}/draws.json`)),passes=draws.filter(d=>d.ownerMethod==='runUpdatePass');assert(passes.length>0);
  frames.push(passes.map(d=>{
   assert.deepEqual(d.state.viewport,[0,0,size,size]);assert.equal(d.uniforms.stateTex.values[0],0);
   const parameters=Object.fromEntries(Object.entries(d.uniforms).filter(([,u])=>u.type===5126&&u.size===1).map(([name,u])=>[name,u.values[0]]));
   const uniforms=bindSymmetryCustomParameters(program,parameters);
   for(const name of program.bindingNames){const u=d.uniforms[name];if(u)assert.equal(uniforms[name],u.values[0],`Matched source float ${name}`);}
   const additional=Object.entries(d.uniforms).filter(([name])=>!['stateTex','iterations'].includes(name)&&!program.bindingNames.includes(name));
   assert(mode||additional.length===0,'Context/default bindings require the retained owner diagnostic');
   // These are observed GL inputs, not an implementation of Processing's
   // context-uniform preparation. Preserve the distinction in the manifest.
   const typedBindings=additional.map(([name,u])=>({name:name.replace(/\[0\]$/,''),type:u.type,values:u.values}));
   return{iterations:d.uniforms.iterations.values[0],uniforms,...(mode?{typedBindings}:{} )};
  }));
  originalStates.push(await ref(`frame-${frame.index}/state-current-level-0.bin`));
 }
 await vite.close();vite=undefined;
 const manifest={count,size,seed:out+'/seed.bin',vertex:program.vertex,fragment:program.fragment,bindingNames:program.bindingNames,frames};await writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
 report.layout={count,size,texels:size*size,padding:size*size-count};report.dialect=program.dialect;report.bindingNames=program.bindingNames;report.passes=frames.map(p=>p.map(v=>v.iterations));
 const executable=out+'/renderer',build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','-I','server/render',fixture,'-o',executable],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});await writeFile(out+'/compile.log',build.stderr??'');assert.equal(build.error,undefined);assert.equal(build.status,0,build.stderr);assert.equal(build.stderr,'');report.executableSha256=sha(await readFile(executable));
 const native=spawnSync(executable,[out+'/manifest.json',out],{encoding:'utf8',timeout:120000,killSignal:'SIGKILL',maxBuffer:65536});await writeFile(out+'/native.json',native.stdout??'');await writeFile(out+'/native.stderr',native.stderr??'');assert.equal(native.error,undefined);assert.equal(native.status,0,native.stdout+'\n'+native.stderr);assert.equal(native.stderr,'');report.native=JSON.parse(native.stdout);assert.equal(report.native.status,'observed');assert.equal(report.native.handlesAfterDelete,0);assert.equal(report.native.contextReleased,true);
 if(mode){assert.equal(report.native.diagnosticUnit,'completed-pass');assert.equal(report.native.drawViewAdditionalBytes,0);assert.equal(report.native.retainedBytes,size*size*64+(Buffer.byteLength(program.vertex)+Buffer.byteLength(program.fragment))*3+1024*1024);assert.equal(Object.keys(report.native.lifecycle).length,13);assert(Object.values(report.native.lifecycle).every(v=>v===true));}
 for(let index=0;index<originalStates.length;index++){
  const actual=await readFile(out+`/frame-${index}.bin`),expected=originalStates[index];assert.equal(actual.length,expected.length);let activeWordDifferences=0,paddingWordDifferences=0;
  for(let at=0;at<actual.length;at+=4)if(actual.readUInt32LE(at)!==expected.readUInt32LE(at)){if(at<count*16)activeWordDifferences++;else paddingWordDifferences++;}
  report.frames.push({index,bytes:actual.length,activeWordDifferences,paddingWordDifferences,actualSha256:sha(actual),expectedSha256:sha(expected)});
 }
 report.status=report.frames.every(f=>f.activeWordDifferences===0&&f.paddingWordDifferences===0)?'passed':'differences';if(report.status!=='passed')process.exitCode=1;
}catch(error){report.status='failed';report.error=String(error?.stack??error);process.exitCode=1;}
finally{
 await vite?.close();report.sourceAfter={};report.referenceAfter={};
 for(const [before,after] of [[report.sourceBefore,report.sourceAfter],[report.referenceBefore,report.referenceAfter]])for(const p of Object.keys(before))after[p]=sha(await readFile(p));
 report.inputsStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter)&&JSON.stringify(report.referenceBefore)===JSON.stringify(report.referenceAfter);if(!report.inputsStable){report.status='failed';process.exitCode=1;}
 report.seconds=(performance.now()-began)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,seconds:report.seconds,inputsStable:report.inputsStable,frames:report.frames.map(({index,activeWordDifferences,paddingWordDifferences})=>({index,activeWordDifferences,paddingWordDifferences})),error:report.error}));
}
