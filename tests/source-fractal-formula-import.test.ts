import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {defaultFormulas,formulaLabels} from '../src/engine/formulas';

const read=(extra:Record<string,unknown>)=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'Fractal formula import',fractal:{formula_id:'newton'},...extra}));
describe('Fractal source TexMobject import boundary',()=>{
 it('generates its main label and retains ignored main latex and extra labels as provenance',()=>{
  const raw={main_equation:{enabled:true,latex:{ignored:true}},formulas:[{latex:'not an original label',position:'ignored'}]},result=read(raw),scene=result.scene;
  expect(scene.formulas).toMatchObject({layout:'source-surface-centered-v1',main:{visible:true,x:0,y:200,scale:.25,color:'#ffffff'},additional:[]});
  expect(scene.formulas!.main).not.toHaveProperty('latex');expect(formulaLabels(scene)).toHaveLength(1);expect(formulaLabels(scene)[0].latex).toContain('z_n^3');
  expect(scene.provenance!.original).toMatchObject(raw);expect(result.warnings.join(' ')).toContain('不读取附加公式');
  scene.formulas!.main.latex='authored override';expect(formulaLabels(parseScene(serializeScene(scene)))[0].latex).toBe('authored override');
 });
 it('does not parse disabled styles and recognizes source boolean strings',()=>{
  for(const enabled of [false,'FALSE',' true ',null]){
   const scene=read({main_equation:{enabled,position:'ignored',scale:'ignored',color:{},latex:3}}).scene;
   expect(formulaLabels(scene)).toEqual([]);expect(parseScene(serializeScene(scene)).formulas).toEqual(scene.formulas);
  }
  expect(read({main_equation:{enabled:'TrUe'}}).scene.formulas!.main.visible).toBe(true);
 });
 it('uses source Float32 scalars and default positions for missing, null or short arrays',()=>{
  for(const position of [undefined,null,[],['unused']])expect(read({main_equation:{enabled:true,position}}).scene.formulas!.main).toMatchObject({x:0,y:200});
  const scene=read({main_equation:{enabled:true,position:[.1,'0x1.8p2','ignored'],scale:.03,color:'#D0E0F0'}}).scene;
  expect(scene.formulas!.main).toMatchObject({x:Math.fround(.1),y:6,scale:Math.fround(.03),color:'#d0e0f0'});
  const restored=parseScene(serializeScene(scene));expect(restored.formulas).toEqual(scene.formulas);
  expect(restored.provenance!.sourceNumberTokens).toContainEqual({path:['main_equation','scale'],token:'0.03'});
  expect(read({main_equation:{enabled:true,scale:'1/2'}}).scene.formulas!.main.scale).toBe(.25);
 });
 it('keeps original color recovery explicit and rejects unsupported nonfinite/transparent styles',()=>{
  expect(read({main_equation:{enabled:true,color:'not a color'}}).scene.formulas!.main.color).toBe('#ffffff');
  for(const position of ['invalid',['1+1',0]])expect(()=>read({main_equation:{enabled:true,position}})).toThrow();
  expect(()=>read({main_equation:{enabled:true,scale:'NaN'}})).toThrow('非有限');
  expect(()=>read({main_equation:{enabled:true,color:'#80000000'}})).toThrow('透明颜色');
 });
 it('does not migrate a saved generic layout when a source Fractal is reopened',()=>{
  const scene=read({main_equation:{enabled:false}}).scene;scene.formulas=defaultFormulas();scene.formulas.main={...scene.formulas.main,visible:true,latex:'local',x:90,y:80,scale:2};
  const reopened=parseScene(serializeScene(scene));expect(reopened.formulas).toEqual(scene.formulas);expect(formulaLabels(reopened)[0].latex).toBe('local');
 });
});
