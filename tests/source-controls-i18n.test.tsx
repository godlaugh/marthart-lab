import {describe,it,expect} from 'vitest';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nProvider} from '../src/i18n';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceFractalControls} from '../src/components/SourceFractalControls';
import {SourceFractalClipEditor} from '../src/components/SourceFractalClipEditor';
import {SourceBouncingControls} from '../src/components/SourceBouncingControls';
import {SourcePerlinCpuControls} from '../src/components/SourcePerlinCpuControls';
import {SourcePerlinGpuControls} from '../src/components/SourcePerlinGpuControls';
import {SourcePerlinBackendControls} from '../src/components/SourcePerlinBackendControls';
import {PerlinParameterActionsEditor} from '../src/components/PerlinParameterActionsEditor';
import {SourceSurfaceControls} from '../src/components/SourceSurfaceControls';
import {SourceSurfacePaletteEditor} from '../src/components/SourceSurfacePaletteEditor';
import {SOURCE_BOUNCING_POSITION_MODES} from '../src/engine/sourceBouncingConfig';
const noop=()=>{};
const parse=(type:string,extra:Record<string,unknown>={})=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type,name:'Author title',...extra})).scene;
function english(node:ReactNode){
 const out=renderToStaticMarkup(<I18nProvider language="en">{node}</I18nProvider>);
 expect(out.length).toBeGreaterThan(100);
 expect(out.match(/[\u3400-\u9fff][^<"&]*/g)).toBeNull();
 return out;
}
describe('source controls use their real translation owners',()=>{
 it.each(['mandelbrot','julia','newton','nova'])('renders %s formula, legacy, viewport and dynamic action controls in English',formula_id=>{
  const scene=parse('FRACTAL',{fractal:{formula_id},timeline:[{type:'animate',duration:1,actions:[{method:'center',args:[1,2]},{method:'ambient',args:[.1,.2,.3]},{method:'paramStart',args:{parameters:{bailout:{min:1,max:4,step:.1}}}},{method:'gradientStart',args:{mode:'HUE_ROTATE',speed:30}}]}]});
  const before=JSON.stringify(scene),markup=english(<><SourceFractalControls scene={scene} onChange={noop}/><SourceFractalClipEditor scene={scene} track={scene.timeline.tracks[0]} onChange={noop}/></>);
  expect(markup).toContain('Change Center');expect(markup).toContain('Change Ambient rotation speed');expect(markup).toContain('value="webgl2"');expect(markup).toContain('value="multi-pass"');expect(markup).toContain('Parameter action 1');expect(JSON.stringify(scene)).toBe(before);
  const {parameters: _parameters,...legacy}=scene.fractalSource!.formula;scene.fractalSource={...scene.fractalSource!,formula:legacy};
  english(<SourceFractalControls scene={scene} onChange={noop}/>);
 });
 it('renders all bouncing position modes and appearance controls without translating stored values',()=>{
  const scene=parse('BOUNCING_PARTICLES',{settings:{particle_count:4}});
  for(const mode of SOURCE_BOUNCING_POSITION_MODES){
   scene.bouncingSource!.configuration.initialPositionMode=mode;
   const before=JSON.stringify(scene);english(<><SourceBouncingControls scene={scene} tab="geometry" onChange={noop}/><SourceBouncingControls scene={scene} tab="appearance" onChange={noop}/></>);expect(JSON.stringify(scene)).toBe(before);
  }
 });
 it.each(['particles','field-curves','gpu'])('renders Perlin %s controls and start/stop editors in English',mode=>{
  const scene=parse('PERLIN',{settings:{render_mode:mode==='gpu'?'GPU':'CPU',particle_count:4,curve_count:3}});
  if(mode!=='gpu')scene.perlinSource!.cpuStyle=mode as 'particles'|'field-curves';
  const before=JSON.stringify(scene);english(<><SourcePerlinBackendControls scene={scene} onChange={noop}/><SourcePerlinCpuControls scene={scene} onChange={noop}/><SourcePerlinGpuControls scene={scene} onChange={noop}/><PerlinParameterActionsEditor method="paramStart" value={{kind:'start',parameters:[]}} onChange={noop}/><PerlinParameterActionsEditor method="paramStop" value={{kind:'stop',parameters:[]}} onChange={noop}/></>);expect(JSON.stringify(scene)).toBe(before);
 });
 it.each(['CPU','GPU'])('renders %s surface point and mesh inspector branches in English',render_mode=>{
  for(const surface_mode of ['POINTS','MESH']){
   const scene=parse('SURFACE',{equations:{x:'u',y:'v',z:'0'},settings:{render_mode,surface_mode},timeline:[{type:'surface_mode_transition',duration:1,to:'MESH'}]}),before=JSON.stringify(scene);
   const out=english(<><SourceSurfaceControls scene={scene} onChange={noop}/><SourceSurfacePaletteEditor scene={scene} onChange={noop}/></>);expect(out).toContain('data-testid="source-surface-mesh-controls"');if(render_mode==='GPU'&&surface_mode==='POINTS')expect(out).toContain('Surface parameter domain');expect(JSON.stringify(scene)).toBe(before);
  }
 });
});
