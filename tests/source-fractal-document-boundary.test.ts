import {expect,it} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {sceneAtTime} from '../src/engine/timeline';
import {SOURCE_FRACTAL_ACTION_LIMITS} from '../src/engine/sourceFractalActionConfig';

const source=(actions:unknown[])=>({config_version:'1.0.0',type:'FRACTAL',name:'source boundary',fractal:{formula_id:'newton',parameters:{}},timeline:[{type:'animate',duration:1,actions}]});
const load=(actions:unknown[])=>parseProjectFile(JSON.stringify(source(actions))).scene;
const gradient=()=>load([{method:'gradientStart',args:{mode:'offset_cycle',interpolation:'linear',speed:60}}]);

it('preserves an ignored numeric method lexeme through public import, save and reopen',()=>{
 const rotation={method:'fractalRotate',args:[.125]};
 const text=JSON.stringify(source([{method:77,args:[]},rotation])).replace('"method":77','"method":7.700e1');
 const imported=parseProjectFile(text).scene,restored=parseScene(serializeScene(imported));
 expect(restored.provenance!.sourceNumberTokens).toContainEqual({path:['timeline','0','actions','0','method'],token:'7.700e1'});
 expect(restored.provenance!.original).toHaveProperty(['timeline','0','actions','0','method'],77);
 const control=load([rotation]);
 for(const time of [0,.5,1]){
  const actual=sceneAtTime(restored,time).evaluatedFractalScene!,expected=sceneAtTime(control,time).evaluatedFractalScene!;
  expect(actual.formula).toEqual(expected.formula);expect(actual.scene.object).toEqual(expected.scene.object);
 }
});

it('keeps numeric method token registration limited to exact bounded action fields',()=>{
 const scene=load([]);
 for(const path of [
  ['timeline','0','actions','0','method','0'],
  ['timeline','00','actions','0','method'],
  ['timeline','1000','actions','0','method'],
  ['timeline','0','actions',String(SOURCE_FRACTAL_ACTION_LIMITS.actions),'method'],
 ]){
  const malformed={...scene,provenance:{...scene.provenance,sourceNumberTokens:[{path,token:'77'}]}};
  expect(()=>parseScene(JSON.stringify(malformed))).toThrow('源数字词法记录的字段路径无效');
 }
});

it('preserves valid gradient enum strings and their native branch after save and reopen',()=>{
 const scene=gradient(),restored=parseScene(serializeScene(scene));
 expect(restored.timeline.tracks[0].fractalSource!.gradient).toEqual(scene.timeline.tracks[0].fractalSource!.gradient);
 const frame=sceneAtTime(restored,.5).evaluatedFractalScene!;
 expect(frame).toEqual(sceneAtTime(scene,.5).evaluatedFractalScene);
 expect(frame.offsets.palette).toBe(0);expect(frame.offsets.inside).toBeGreaterThan(0);
});

it.each(['mode','interpolation'] as const)('rejects an array masquerading as canonical gradient %s before persistence or playback',field=>{
 const scene=gradient(),payload=JSON.parse(JSON.stringify(scene));
 const config=payload.timeline.tracks[0].fractalSource.gradient.config;
 config[field]=[config[field]];
 expect(()=>parseScene(JSON.stringify(payload))).toThrow('未知渐变规则');
 expect(()=>sceneAtTime(payload,.5)).toThrow('未知渐变规则');
});
