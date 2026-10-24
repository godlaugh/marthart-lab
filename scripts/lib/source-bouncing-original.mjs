import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
// Capture and comparison consume the same pinned packaged-preset identities.
const presets=Object.values(JSON.parse(readFileSync(new URL('../../tests/fixtures/source-bouncing-native-animation/presets.json',import.meta.url),'utf8')));
export function sourceBouncingOriginalPreset(bytes){
 const digest=createHash('sha256').update(bytes).digest('hex'),preset=presets.find(p=>p.sourceSha256===digest);
 if(!preset||JSON.parse(bytes).settings.particle_count!==preset.particleCount)throw Error('Original preset changed or unsupported');
 return{...preset};
}
/** A guide composition is an explicit derived input, never a packaged preset.
 * The recipe owns inherited settings and the diagnostic update schedule. */
export function sourceBouncingCaptureInput(bytes,run){
 if(run.inputKind===undefined||run.inputKind==='packaged-preset'){
  assert.equal(run.guideCase,undefined);assert.equal(run.animation?.updatesPerFrame??1,1);
  return{...sourceBouncingOriginalPreset(bytes),kind:'packaged-preset',updatesPerFrame:1};
 }
 assert.equal(run.inputKind,'guide-composition');assert.equal(run.mode,'animation');
 const recipeBytes=readFileSync(new URL('../../tests/fixtures/source-bouncing-guide-compositions/cases.json',import.meta.url));
 assert.equal(createHash('sha256').update(recipeBytes).digest('hex'),run.guideRecipeSha256);
 const recipe=JSON.parse(recipeBytes).cases[run.guideCase];assert.ok(recipe,'Unknown guide composition');assert.equal(recipe.updatesPerFrame,10);assert.equal(run.animation.updatesPerFrame,recipe.updatesPerFrame);
 const baseBytes=readFileSync(run.originalSource),base=sourceBouncingOriginalPreset(baseBytes);assert.equal(base.sourceSha256,run.originalSourceSha256);assert.equal(base.member,run.sourceMember);assert.equal(base.member,`data/Bouncing/${recipe.basePreset}.json`);
 const expected=JSON.parse(baseBytes);Object.assign(expected.settings,recipe.settings);expected.name=recipe.name;if(recipe.polygon)expected.polygon=recipe.polygon;
 assert.deepEqual(JSON.parse(bytes),expected,'Guide input differs from its explicit recipe');
 assert.equal(run.probeInput,run.command[4]);const probeInput=readFileSync(run.probeInput),probeHash=createHash('sha256').update(probeInput).digest('hex');assert.equal(probeHash,run.probeInputSha256);assert.deepEqual(JSON.parse(probeInput),{project:expected,updatesPerFrame:recipe.updatesPerFrame});
 return{kind:'guide-composition',guideCase:run.guideCase,basePreset:recipe.basePreset,member:base.member,particleCount:recipe.settings.particle_count,sourceSha256:createHash('sha256').update(bytes).digest('hex'),updatesPerFrame:recipe.updatesPerFrame,inputFiles:{[run.originalSource]:base.sourceSha256,[run.probeInput]:probeHash}};
}
