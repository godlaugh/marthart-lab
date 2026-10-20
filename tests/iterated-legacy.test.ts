import {describe,it,expect} from 'vitest';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {definition} from '../src/scenes';
import {iteratedUniform} from '../src/scenes/iteratedDensity';
import {symmetryStep} from '../src/scenes/iterated';
const context={time:0,width:64,height:48,quality:'preview' as const};
const legacy=(type:string,extra:Record<string,unknown>)=>parseLegacyScene(JSON.stringify({config_version:'1.0.0',name:'Iteration import regression',type,...extra}),{iteratedCamera:'legacy-v1'});
describe('legacy iterated coordinate and template semantics',()=>{
 it('preserves requested legacy backend and rejects unknown values explicitly',()=>{for(const [render_mode,expected]of [['CPU','cpu'],['GPU','gpu'],['AUTO','auto']]){const imported=legacy('MAP_ATTRACTOR',{equations:{x_next:'x',y_next:'y'},settings:{render_mode,batch_size:1,burn_in_steps:0}});expect(imported.scene.settings.iteratedBackend).toBe(expected);expect(imported.warnings.join()).toContain('后端选择已保留');expect(imported.warnings.join()).not.toContain('后端选择不移植');}expect(()=>legacy('MAP_ATTRACTOR',{equations:{x_next:'x',y_next:'y'},settings:{render_mode:'MAGIC'}})).toThrow(/render_mode/);});
 it('preserves noncentered zero-width X/Y boxes and evaluates nx/ny cascades with true source Z initialization',()=>{
  const imported=legacy('MAP_ATTRACTOR',{equations:{x_next:'x+1',y_next:'nx+y',z_next:'ny+z'},settings:{dimension:3,batch_size:1,burn_in_steps:0,x0_min:1,x0_max:1,y0_min:2,y0_max:2}});
  expect(imported.scene.settings.initialZMin).toBe(-1);expect(imported.scene.settings.initialZMax).toBe(1);
  const initialZ=iteratedUniform(Number(imported.scene.settings.seed),0,0,2)*2-1;
  expect(imported.scene.settings.dimension).toBe(3);expect(imported.scene.settings.iteratedMode).toBe('continuous');
  const xy=definition('map').generate(imported.scene,context);expect(xy.type).toBe('raster');expect(xy.dimension).toBe(2);expect((xy.density!.bounds.minX+xy.density!.bounds.maxX)/2).toBe(2);expect((xy.density!.bounds.minY+xy.density!.bounds.maxY)/2).toBe(4);
  imported.scene.settings.densityProjection='xz';const xz=definition('map').generate(imported.scene,context);expect(xz.density!.projection).toBe('xz');expect((xz.density!.bounds.minY+xz.density!.bounds.maxY)/2).toBeCloseTo(4+initialZ,12);
 });
 it('accepts camel-case aliases without losing dimension, disabled Z expressions or batch semantics warnings',()=>{
  const imported=legacy('MAP_ATTRACTOR',{equations:{xNext:'1',yNext:'2',zNext:'sin('},settings:{dimension:2,batchSize:1,burnInSteps:0,iterationsPerFrame:3}});
  expect(imported.scene.equations.z).toBe('sin(');expect(imported.scene.settings.iterationsPerFrame).toBe(3);const output=definition('map').generate(imported.scene,context);expect(output.type).toBe('raster');expect(output.stats.samples).toBe(3);expect((output.density!.bounds.minX+output.density!.bounds.maxX)/2).toBe(1);expect((output.density!.bounds.minY+output.density!.bounds.maxY)/2).toBe(2);expect(imported.warnings.join()).toContain('固定 60 Hz');
 });
 it('uses identity Z only for the documented missing three-dimensional equation',()=>{const imported=legacy('MAP_ATTRACTOR',{equations:{x_next:'x',y_next:'y'},settings:{dimension:3,batch_size:1,burn_in_steps:0}});expect(imported.scene.equations.z).toBe('z');expect(imported.warnings.join()).toContain('保持 z');expect(()=>legacy('MAP_ATTRACTOR',{equations:{x_next:'x',y_next:'y'},settings:{dimension:4}})).toThrow('dimension');expect(()=>legacy('MAP_ATTRACTOR',{equations:{x_next:'x',y_next:'y'},settings:{x0_min:2,x0_max:1}})).toThrow('上限');});
 it('executes Modified delta and delta_power while retaining the descriptive formula as evidence',()=>{
  const parameters={lambda:1,alpha:-.1,beta:.2,gamma:.1,omega:.01,delta:.3,symmetry_degree:7,delta_power:4},imported=legacy('SYMMETRY_CHAOS',{parameters,equation:{template:'modified',formula:'display-only formula'},settings:{batch_size:1,burn_in_steps:0}});
  expect(imported.scene.settings.template).toBe('modified');expect(imported.scene.settings.deltaPower).toBe(4);expect(imported.scene.equations.formula).toBe('display-only formula');
  const seed=Number(imported.scene.settings.seed),expected=symmetryStep(.001+iteratedUniform(seed,0,0,0)*.001,.001+iteratedUniform(seed,0,0,1)*.001,{...parameters,n:7,template:'modified',deltaPower:4}),output=definition('symmetry').generate(imported.scene,context);expect(output.type).toBe('raster');expect((output.density!.bounds.minX+output.density!.bounds.maxX)/2).toBeCloseTo(expected[0],12);expect((output.density!.bounds.minY+output.density!.bounds.maxY)/2).toBeCloseTo(expected[1],12);
 });
 it('retains unknown templates for explicit generation failure and rejects invalid Modified powers',()=>{const imported=legacy('SYMMETRY_CHAOS',{equation:{template:'future-template'},settings:{batch_size:1}});expect(imported.scene.settings.template).toBe('future-template');expect(()=>definition('symmetry').generate(imported.scene,context)).toThrow('不支持');expect(()=>legacy('SYMMETRY_CHAOS',{parameters:{delta_power:7}})).toThrow('范围');});
});
