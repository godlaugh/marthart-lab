import {describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {prepareSourceSymmetryCustomProgram} from '../src/engine/sourceSymmetryCustom';

describe.skipIf(process.platform!=='darwin')('retained custom fragment CGL state',()=>{
 it('preserves seed bits, typed array/matrix bindings and unbound link defaults through reset and failure',()=>{
  mkdirSync('.cache',{recursive:true});const out=mkdtempSync(resolve('.cache/symmetry-state-')),manifest=join(out,'input.json'),executable=join(out,'renderer');
  const source=prepareSourceSymmetryCustomProgram('uniform float gain;uniform vec2 defaultOffset=vec2(.5,-.25);uniform int defaultCount=2;uniform float defaultMetric=.125;uniform vec2 supplied[2];uniform mat3 basis;\nvoid calculate_next(in vec3 pos,out vec3 nextPos,out float metric){nextPos=pos+basis*vec3(defaultOffset*gain+supplied[1],9.);metric=float(defaultCount)+defaultMetric+supplied[0].x;}',5);
  const seed=new Float32Array([-0,0,9,-0,.25,-.5,8,3,1,2,7,4,0,0,0,0]);writeFileSync(join(out,'seed.bin'),Buffer.from(seed.buffer));
  const pass=(iterations:number)=>({iterations,uniforms:{gain:2},typedBindings:[{name:'supplied',type:35664,values:[.25,.5,1,2]},{name:'basis',type:35675,values:[1,0,0,0,1,0,0,0,1]}]});
  const partial=pass(2);partial.typedBindings[0].values=[.75,.5];
  writeFileSync(manifest,JSON.stringify({...source,count:3,size:2,seed:join(out,'seed.bin'),frames:[[pass(3),pass(3)],[partial]]}));
  const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','-I','server/render','tests/fixtures/source-symmetry-state/runner.m','-o',executable],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');
  const run=spawnSync(executable,[manifest,out],{encoding:'utf8',timeout:15000,killSignal:'SIGKILL',maxBuffer:65536});writeFileSync(join(out,'native.json'),run.stdout);writeFileSync(join(out,'native.stderr'),run.stderr);expect(run.error).toBeUndefined();expect(run.status,run.stdout+'\n'+run.stderr).toBe(0);expect(run.stderr).toBe('');
  const facts=JSON.parse(run.stdout);expect(facts.status).toBe('observed');expect(Object.values(facts.lifecycle)).toEqual(Array(13).fill(true));expect(facts.drawViewAdditionalBytes).toBe(0);expect(facts.diagnosticUnit).toBe('completed-pass');expect(facts.handlesAfterDelete).toBe(0);expect(facts.contextReleased).toBe(true);
  for(const [frame,steps] of [[0,6],[1,8]]){const expected=new Float32Array(16);for(let id=0;id<4;id++)expected.set([seed[id*4]+2*steps,seed[id*4+1]+1.5*steps,0,frame===0?2.375:2.875],id*4);expect(readFileSync(join(out,`frame-${frame}.bin`))).toEqual(Buffer.from(expected.buffer));}
  expect(facts.lastActiveInvalidPasses).toBe(0);expect(facts.lastActiveValidity).toBe(1);
  const invalid=join(out,'invalid');mkdirSync(invalid);const invalidSource=prepareSourceSymmetryCustomProgram('uniform float zero;void calculate_next(in vec3 pos,out vec3 nextPos,out float metric){nextPos=vec3(1./zero,pos.y+1.,9.);metric=-3.;}',5);writeFileSync(join(invalid,'seed.bin'),Buffer.alloc(16));
  const badPass={iterations:3,uniforms:{zero:0}};writeFileSync(join(invalid,'input.json'),JSON.stringify({...invalidSource,count:1,size:1,seed:join(invalid,'seed.bin'),frames:[[badPass,badPass]]}));
  const invalidRun=spawnSync(executable,[join(invalid,'input.json'),invalid],{encoding:'utf8',timeout:15000,killSignal:'SIGKILL',maxBuffer:65536});writeFileSync(join(invalid,'native.json'),invalidRun.stdout);expect(invalidRun.error).toBeUndefined();expect(invalidRun.status,invalidRun.stdout+'\n'+invalidRun.stderr).toBe(0);expect(invalidRun.stderr).toBe('');
  const invalidFacts=JSON.parse(invalidRun.stdout);expect(invalidFacts.diagnosticUnit).toBe('completed-pass');expect(invalidFacts.lastActiveInvalidPasses).toBe(2);expect(invalidFacts.lastActiveValidity).toBe(0);expect(readFileSync(join(invalid,'frame-0.bin'))).toEqual(Buffer.from(new Float32Array([Infinity,6,0,-3]).buffer));
 },45000);
});
