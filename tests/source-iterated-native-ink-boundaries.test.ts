import {describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {prepareSourceSymmetryTone} from '../src/engine/sourceSymmetryPresentation';
import {prepareSourceIteratedDrawPlan,prepareSourceIteratedPresentPlan,sourceIteratedRenderPrograms} from '../src/engine/sourceIteratedRenderPlan';

// Compiles real production Objective-C methods against a CPU call recorder.
// The synthetic active-uniform table deliberately includes every declaration:
// it tests admission and ownership, never claims what a GL driver links away.
function fixture(){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'CPU ink ownership',type:'SYMMETRY_CHAOS',settings:{batch_size:8,burn_in_steps:0},palette:['#123456','#fedcba']})).scene;
 const job=prepareIteratedFrame(scene,0,0),width=32,height=24;
 const draw=prepareSourceIteratedDrawPlan(job,{width,height,stateWidth:job.config.count,projection:'xy',bounds:{minX:-1,maxX:1,minY:-1,maxY:1}});
 const programs=sourceIteratedRenderPrograms('native-gl41','symmetry',draw.sourceSplatProgram);
 const present=prepareSourceIteratedPresentPlan(prepareSourceSymmetryTone(scene,{width,height}),width,height);
 const declared=Object.fromEntries(Object.entries(programs).map(([name,p])=>{
  const found=new Map<string,string>();
  for(const source of [p.vertex,p.fragment])for(const match of source.matchAll(/\buniform\s+(float|int|bool|vec2|vec3|vec4|ivec2|mat4|sampler2D|usampler2D)\s+([^;]+);/g)){
   for(const symbol of match[2].split(',').map((s:string)=>s.trim())){expect(symbol).toMatch(/^[A-Za-z_]\w*$/);if(found.has(symbol))expect(found.get(symbol)).toBe(match[1]);found.set(symbol,match[1]);}
  }
  return[name,[...found].map(([name,kind])=>({name,kind,size:1}))];
 }));
 const palette=draw.palette.createValues();
 return{count:job.config.count,width,height,programs,declared,draw:{drawUniforms:draw.drawUniforms,statsUniforms:draw.statsUniforms,primitive:draw.primitive,palette:{key:draw.palette.key,format:draw.palette.format,base64:Buffer.from(palette.buffer,palette.byteOffset,palette.byteLength).toString('base64')},noiseBase64:Buffer.from(draw.noisePermutation).toString('base64')},present:{uniforms:present.uniforms,clear:Array.from(present.clear),filter:present.filter}};
}

describe.skipIf(process.platform!=='darwin')('native retained ink CPU ownership boundaries',()=>{
 it('rejects malformed effects before ink mutation and retains failed cleanup ownership',()=>{
  mkdirSync('.cache',{recursive:true});const directory=mkdtempSync(resolve('.cache/iterated-ink-cpu-')),executable=join(directory,'recorder'),input=join(directory,'fixture.json');writeFileSync(input,JSON.stringify(fixture()));
  const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O1','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','tests/fixtures/source-iterated-native-ink-boundaries/runner.m','-o',executable],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
  expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');
  const run=spawnSync(executable,[input],{encoding:'utf8',timeout:10000,killSignal:'SIGKILL',maxBuffer:65536});writeFileSync(join(directory,'result.json'),run.stdout);writeFileSync(join(directory,'stderr.log'),run.stderr);
  expect(run.error).toBeUndefined();expect(run.status,run.stderr).toBe(0);expect(run.stderr).toBe('');const result=JSON.parse(run.stdout);
  expect(result.status).toBe('passed');expect(result.findings).toEqual([]);expect(result.checks).toBeGreaterThan(150);
  expect(result.cases).toEqual(expect.arrayContaining(['all-programs-active-coverage-before-mutation','checkpoint-budget-context','primary-cleanup-error-and-poison','cleanup-retry-retains-exact-handle']));
 },45000);
});
