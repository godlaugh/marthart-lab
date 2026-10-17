import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {spirographClockFixture} from '../scripts/spirograph-clock-fixtures.mjs';
import {sourceLayer} from '../scripts/spirograph-source-oracle.mjs';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {prepareSpirograph} from '../src/scenes/spirograph';
import {spirographFrameClips} from '../src/engine/spirographFrameConfig';
const cases=JSON.parse(readFileSync(new URL('./fixtures/spirograph/source-clock-1.7.8.json',import.meta.url),'utf8')).cases;
describe('browser clock fixtures cross public saved-document admission',()=>{
 for(const c of cases)it(c.id,()=>{
  const layers=c.input.layers.map((l,i)=>sourceLayer('layer-'+i,{...l,statorRadius:60,rotors:[{radius:20,mode:'inside'}],penDistance:27,strokeColor:'#ffffff',palette:['#ffffff']}));
  const scene=spirographClockFixture(createScene(definition('spirograph')),{...c,layers});
  const parsed=parseScene(JSON.stringify(persistentScene(scene))),again=parseScene(JSON.stringify(persistentScene(parsed)));
  expect(again).toEqual(parsed);expect(spirographFrameClips(parsed).clips.length).toBe(c.input.clips.length);
  expect(prepareSpirograph(parsed.settings).layers.map(l=>l.closureTurns*360)).toEqual(c.input.layers.map(l=>l.closureDegrees));
 });
});
