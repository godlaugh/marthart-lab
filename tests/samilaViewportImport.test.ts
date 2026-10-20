import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {IteratedDensitySession} from '../src/scenes/iteratedDensity';
import {parseSourceNumberTokens} from '../src/engine/sourceNumberTokens';
import {importSamilaViewportScalar} from '../src/engine/samilaViewportImport';

const source=(settings:Record<string,unknown>={})=>({config_version:'1.0.0',type:'SAMILA',name:'NDC import',equations:{f1:'0.5',f2:'0.25'},settings:{batch_size:2,generate_mode:'f2_vs_f1',projection:'rectilinear',...settings},camera:{theta:.7,zoom:10}});
describe('source Samila viewport import',()=>{
 it('selects the explicit new profile with native viewport defaults and retains unused camera',()=>{
  const raw=source(),imported=parseLegacyScene(JSON.stringify(raw));
  expect(imported.scene.settings).toMatchObject({samilaProjectionModel:'source-ndc-v1',samilaCameraModel:'anchored-theta-v1',samilaHistoryModel:'bounded-v2',samilaCameraTheta:0,scaleX:Math.fround(.33),scaleY:Math.fround(.33),offsetX:0,offsetY:0,rotation:0});
  expect(imported.source).toEqual(raw);expect(imported.warnings.join(' ')).toContain('使用文档固定帧率');expect(imported.warnings.join(' ')).toContain('原版实时线程时钟');
  expect(parseScene(serializeScene(imported.scene)).settings).toEqual(imported.scene.settings);
 });
 it('does not reinterpret literal getter fields as formula expressions or bind parameters',()=>{
  const raw=source({scale_x:'1/2',scale_y:null,offset_x:'0x1p-2',offset_y:'PI',rotation:'1e-1'});
  const imported=parseLegacyScene(JSON.stringify(raw));
  expect(imported.scene.settings).toMatchObject({scaleX:1,scaleY:1,offsetX:.25,offsetY:0,rotation:Math.fround(.1)});
  expect(imported.source).toEqual(raw);expect(imported.warnings.join(' ')).toContain('getFloat');
  expect(importSamilaViewportScalar('scale_x',true,true)).toEqual({ok:true,value:1,defaulted:true});
  expect(importSamilaViewportScalar('scale_x','1e999',true).ok).toBe(false);
  expect(()=>parseLegacyScene(JSON.stringify(source({offset_x:'NaN'})))).toThrow('非有限');
 });
 it('keeps native ignored Z fields and malformed camera in provenance without applying them',()=>{
  const raw={...source({scale_z:'ignored',offset_z:{unused:true}}),camera:'ignored by constructor'};
  const imported=parseLegacyScene(JSON.stringify(raw));expect(imported.source).toEqual(raw);expect(imported.scene.settings.samilaCameraTheta).toBe(0);
 });
 it('persists exact registered numeric source tokens through the public file adapter',()=>{
  const text=JSON.stringify(source({scale_x:.3,offset_y:-.2})).replace('"scale_x":0.3','"scale_x":0.30000000000000000001');
  const parsed=parseProjectFile(text);expect(parsed.scene.provenance?.sourceNumberTokens).toContainEqual({path:['settings','scale_x'],token:'0.30000000000000000001'});
  expect(parseScene(serializeScene(parsed.scene)).provenance).toEqual(parsed.scene.provenance);
  expect(()=>parseSourceNumberTokens([{path:['camera','theta'],token:'1'}],'samila')).toThrow('路径');
 });
 it('retains former import behavior explicitly and does not migrate saved local projects',()=>{
  const text=JSON.stringify(source());
  const old=parseLegacyScene(text,{samilaProjection:'legacy-v1'}).scene;
  expect(old.settings.samilaProjectionModel).toBeUndefined();expect(old.settings.samilaCameraTheta).toBe(.7);
  expect(parseProjectFile(serializeScene(old)).scene.settings).toEqual(old.settings);
  expect(parseLegacyScene(text,{samilaCamera:'legacy-v1'}).scene.settings.samilaCameraModel).toBeUndefined();
 });
 it('rejects duplicate JSON members before reading the source viewport or unknown fields',()=>{
  const text=JSON.stringify(source({scale_x:.2})).replace('"scale_x":0.2','"scale_x":0.2,"scale_x":0.4');
  expect(()=>parseLegacyScene(text)).toThrow();expect(()=>parseLegacyScene(text,{samilaProjection:'legacy-v1'})).not.toThrow();
  const camera=JSON.stringify(source()).replace('"theta":0.7','"theta":0.7,"theta":1');
  expect(()=>parseProjectFile(camera)).toThrow();
 });
 it('renders a finite source rotation outside the old local authoring range',()=>{
  const scene=parseLegacyScene(JSON.stringify(source({rotation:10001}))).scene;scene.settings.iteratedBackend='cpu';
  const owner=new IteratedDensitySession();try{expect(owner.generate(scene,{time:0,width:16,height:16,quality:'export'}).type).toBe('raster');}finally{owner.reset();}
 });
 it('delivers fixed NDC bounds through the production renderer so scale and offset remain visible',()=>{
  const scene=parseLegacyScene(JSON.stringify(source({scale_x:.5,scale_y:.5,offset_x:.25,offset_y:0,spot_size:.04}))).scene;
  scene.settings.iteratedBackend='cpu';const session=new IteratedDensitySession();
  try{const output=session.generate(scene,{time:0,width:80,height:40,quality:'export',samilaPrimaryPixelHeight:1080});expect(output.density?.bounds).toEqual({minX:-1,maxX:1,minY:-1,maxY:1});
   const ink=session.snapshotInk();let mass=0,x=0,y=0;for(let i=0;i<80*40;i++){mass+=ink[i*4+3];x+=(i%80+.5)*ink[i*4+3];y+=(Math.floor(i/80)+.5)*ink[i*4+3];}
   expect(mass).toBeGreaterThan(0);expect(x/mass).toBeCloseTo(60,0);expect(y/mass).toBeCloseTo(15,0);
  }finally{session.reset();}
 });
});
