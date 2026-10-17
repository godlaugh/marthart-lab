import {describe,expect,it} from 'vitest';
import {definition} from '../src/scenes';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {matchingPerlinPreset,refreshPerlinSeed} from '../src/engine/perlinPreset';
import {generateScene} from '../src/engine/temporal';

const def=definition('perlin');
describe('Perlin recipe identity and seed refresh',()=>{
  it('matches every built-in recipe after renaming, copying and saving',()=>{
    for(const preset of def.presets){
      const scene=createScene(def,preset);scene.id='copied-artwork';scene.name='My custom name';
      const restored=parseScene(JSON.stringify(persistentScene(scene)));
      expect(matchingPerlinPreset(restored,def)?.id).toBe(preset.id);
    }
  });
  it('marks changed active parameters as custom and recognizes an exact undo',()=>{
    for(const id of ['soft-flow','vector-drift','swirl-vortex']){
      const preset=def.presets.find(p=>p.id===id)!,scene=createScene(def,preset);
      const changed={...scene,settings:{...scene.settings,particleSpeed:Number(scene.settings.particleSpeed)+1}};
      expect(matchingPerlinPreset(changed,def)).toBeUndefined();
      expect(matchingPerlinPreset(scene,def)?.id).toBe(id);
      expect(matchingPerlinPreset({...scene,settings:refreshPerlinSeed(scene.settings,100)},def)).toBeUndefined();
    }
  });
  it('ignores inactive settings, artwork metadata, palette and compute backend',()=>{
    const preset=def.presets.find(p=>p.id==='vector-drift')!,scene=createScene(def,preset);
    scene.settings={...scene.settings,angleMap:'soft-power',textureBrightness:2,background:'#ffffff',perlinBackend:'gpu'};
    scene.palette.offset=.25;scene.camera.zoom=2;scene.description='Saved variation';
    expect(matchingPerlinPreset(scene,def)?.id).toBe(preset.id);
    scene.settings.flow='angle';expect(matchingPerlinPreset(scene,def)).toBeUndefined();
  });
  it('does not use catalog ordering to resolve an ambiguous recipe',()=>{
    const scene=createScene(def,def.presets[0]);
    expect(matchingPerlinPreset(scene,{...def,presets:[...def.presets,{...def.presets[0],id:'duplicate'}]})).toBeUndefined();
  });
  it('changes only the seed, guarantees difference and rejects invalid entropy',()=>{
    const settings=Object.freeze({...def.defaults.settings,seed:0xffffffff});
    const refreshed=refreshPerlinSeed(settings,0xffffffff);
    expect(refreshed).toEqual({...settings,seed:0});expect(settings.seed).toBe(0xffffffff);
    for(const n of [-1,.5,NaN,Infinity,2**32])expect(()=>refreshPerlinSeed(settings,n)).toThrow();
  });
  it('changes the real field and reproduces it after project roundtrip',()=>{
    const scene=createScene(def,def.presets[0]);scene.settings={...scene.settings,count:16,steps:24};
    const changed={...scene,settings:refreshPerlinSeed(scene.settings,123456)};
    const context={time:.5,width:96,height:64,quality:'export' as const};
    const before=generateScene(scene,context),after=generateScene(changed,context),reload=generateScene(parseScene(JSON.stringify(persistentScene(changed))),context);
    expect(before.type).toBe('geometry');expect(after.type).toBe('geometry');expect(reload.type).toBe('geometry');
    if(before.type!=='geometry'||after.type!=='geometry'||reload.type!=='geometry')throw new Error('Expected actual geometry');
    expect(after.positions).not.toEqual(before.positions);expect(after.positions).toEqual(reload.positions);
  });
});
