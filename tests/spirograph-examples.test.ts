import {describe,it,expect} from 'vitest';
import {definition} from '../src/scenes';
import {createScene,parseScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {resolveTimeline} from '../src/engine/timeline';
import recipes from '../src/scenes/spirographExamples.recipes.json';
import type {SceneDocument} from '../src/types';
const def=definition('spirograph');
function content(scene:SceneDocument){
 const copy=structuredClone(scene);delete copy.provenance?.reference;
 copy.provenance!.warnings=copy.provenance!.warnings.filter(w=>!recipes.some(r=>r.reference.assumptions.some(a=>a===w)));
 copy.timeline.tracks.forEach((t,i)=>{t.id=`track-${i}`;t.actions?.forEach((a,j)=>{a.id=`action-${j}`;});});
 const {id,name,description,kind,favorite,...document}=copy;void id;void name;void description;void kind;void favorite;return document;
}
describe('source Spirograph guide documents',()=>{
 it('retains all four existing presets and adds three source-backed recipes',()=>{
  expect(def.presets.filter(p=>p.id.startsWith('guide-spirograph-')).map(p=>p.id)).toEqual(recipes.map(r=>r.id));
  expect(def.presets.filter(p=>!p.id.startsWith('guide-spirograph-')).map(p=>p.id)).toEqual(['hypotrochoid','rose-wheel','epitrochoid','chain']);
 });
 it.each(recipes)('binds $id to the production import owner, queue and source provenance',recipe=>{
  const scene=createScene(def,def.presets.find(p=>p.id===recipe.id));
  expect(content(scene)).toEqual(content(parseProjectFile(JSON.stringify(recipe.config)).scene));
  expect(scene.provenance?.original).toEqual(recipe.config);expect(scene.provenance?.reference).toEqual(recipe.reference);
  expect(parseScene(JSON.stringify(scene))).toEqual(scene);expect(scene.settings).toMatchObject({spirographVersion:'mathart-1.7.8-v1',spirographClock:'source-frame-v1',spirographSimulationFps:60,spiroView:'native',rotation:0,offsetY:0});expect(scene.spirographFrameEvents).toEqual([]);
  expect(scene.timeline).toMatchObject({schedule:'spirograph-sequence-v1',duration:.1});expect(scene.timeline.tracks[0].duration).toBe(1200);
  expect(resolveTimeline(scene).duration).toBeLessThan(1200);
 });
 it('preserves the published Rose straight-line degeneracy and exact other guide geometry',()=>{
  const layers=recipes.map(r=>JSON.parse(String(createScene(def,def.presets.find(p=>p.id===r.id)).settings.layers))[0]);
  expect(layers.map(l=>[l.statorRadius,l.penDistance,l.rotors.map((r:{radius:number;mode:string})=>[r.radius,r.mode])])).toEqual([[150,75,[[75,'inside']]],[150,60,[[50,'inside']]],[150,40,[[75,'inside'],[30,'outside']]]]);
  expect(recipes[0].reference.assumptions.join(' ')).toContain('直线');
 });
});
