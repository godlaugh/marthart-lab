import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {changeMapDimension,mapDimension} from '../src/engine/mapDimension';
import {reconcileEquationDraft} from '../src/engine/equationEditor';
import {compileMapIterator} from '../src/scenes/iterated';
import {EquationEditor} from '../src/components/EquationEditor';

describe('map dimension edit and retained equation drafts',()=>{
 it('changes the actual producer axes, resets z on explicit changes, and roundtrips empty z',()=>{
  const def=definition('map'),scene=createScene(def);scene.equations={x:'x+.1',y:'y+.2',z:'z+.3'};
  Object.assign(scene.settings,{dimension:3,iteratedMode:'single',presentation:'points',count:8,burnIn:0,initialMode:'box',initialXMin:1,initialXMax:1,initialYMin:1,initialYMax:1,initialZMin:1,initialZMax:1});
  const two=changeMapDimension(scene,'2'),three=changeMapDimension(parseScene(JSON.stringify(two)),'3');
  expect(scene.equations.z).toBe('z+.3');expect(two.equations).toEqual({x:'x+.1',y:'y+.2',z:''});expect(three.equations.z).toBe('z');
  const ctx={time:0,quality:'preview' as const,width:80,height:60},flat=def.generate(two,ctx),depth=def.generate(three,ctx);
  expect(flat.type).toBe('geometry');expect(depth.type).toBe('geometry');
  if(flat.type!=='geometry'||depth.type!=='geometry')throw Error('Expected actual point producer');
  expect([...flat.positions].filter((_,i)=>i%3===2)).toEqual(Array(8).fill(0));
  expect([...depth.positions].filter((_,i)=>i%3===2)).toEqual(Array(8).fill(1));
  expect(compileMapIterator({x:two.equations.x,y:two.equations.y,z:two.equations.z},{},mapDimension(two.settings))([1,2,999])).toEqual([1.1,2.2,0]);
 });
 it('does not reset source on parse, unchanged selection, or another field commit',()=>{
  const scene=createScene(definition('map'));scene.settings.dimension='2';scene.equations.z='user_kept_legacy_source';
  const read=parseScene(JSON.stringify(scene));expect(read.equations.z).toBe(scene.equations.z);expect(changeMapDimension(read,2)).toBe(read);
  const draft={...scene.equations,x:'unapplied(',y:'y+.9'},next=changeMapDimension({...scene,settings:{...scene.settings,dimension:3}},2);
  expect(reconcileEquationDraft(scene,next,draft)).toEqual({...draft,z:''});
  expect(reconcileEquationDraft(scene,{...scene,id:'another'},draft)).toEqual(scene.equations);
 });
 it('keeps invalid settings explicit while a valid selection can repair them',()=>{
  const scene=createScene(definition('map'));scene.settings.dimension=2.5;scene.equations.z='z+1';
  expect(()=>mapDimension(scene.settings)).toThrow();expect(()=>changeMapDimension(scene,'bad')).toThrow();
  expect(changeMapDimension(scene,3).equations.z).toBe('z');expect(scene.equations.z).toBe('z+1');
 });
 it('hides the unused 2D z editor and does not let its retained invalid text disable x/y',()=>{
  const def=definition('map'),scene=createScene(def);scene.equations.z='invalid(';
  const html=renderToStaticMarkup(<EquationEditor scene={scene} equations={def.equations} draft={{...scene.equations,x:'x+1'}} onChange={()=>{}} onApply={()=>{}}/>);
  expect(html).not.toContain('zₙ₊₁');expect(html).not.toContain('aria-invalid="true"');expect(html).not.toContain('disabled=""');
 });
});
