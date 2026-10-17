import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {withDomainRenderPolicy,withDomainColorVersion,withDomainViewportVersion,withDomainIterationVersion} from '../src/engine/domainAuthoring';
import {parseDomainRenderPolicy} from '../src/engine/domainRenderPolicy';
import {domainIdealPoint} from '../src/engine/domainViewport';
import {planeNavigation,panPlane,zoomPlane,fitPlane} from '../src/engine/planeNavigation';
import {DomainColorControls} from '../src/components/DomainColorControls';
import {I18nProvider} from '../src/i18n';
import {definition} from '../src/scenes';
import type {SceneDocument,RasterOutput} from '../src/types';

const base=()=>{const s=createScene(definition('domain'));s.equations={f:'z',next:'w+1'};Object.assign(s.settings,{domainBackend:'cpu',domainIterationVersion:'mathart-1.7.8-gpu',domainViewportVersion:'local-v1',domainColorVersion:'local-v1',iterationEnabled:false,seedMode:'CONSTANT_C',constantReal:3,constantImag:4,scale:2,rotation:.4,centerX:.1,centerY:-.2});return s;};
const generate=(scene:SceneDocument)=>{const result=definition('domain').generate(scene,{time:0,quality:'export',width:17,height:13});if(result.type!=='raster')throw Error('expected raster');return result;};
const unchanged=(scene:SceneDocument)=>{const value=structuredClone(scene);delete value.settings.domainRenderPolicy;return value;};

describe('explicit Domain whole-chain recovery authoring',()=>{
 it('keeps omitted1723 policy omitted through save and matches explicit compatibility output',()=>{
  const s=base(),before=JSON.stringify(s),loaded=parseScene(JSON.stringify(persistentScene(s)));
  expect(JSON.stringify(loaded)).toBe(before);expect(loaded.settings.domainRenderPolicy).toBeUndefined();expect(parseDomainRenderPolicy(undefined)).toBe('selected-rules-1723');
  expect(generate(loaded).pixels).toEqual(generate(withDomainRenderPolicy(loaded,'selected-rules-1723')).pixels);
 });
 it.each(['selected-rules-1723','source-cpu-on-gpu-failure-v1','source-cpu-always-v1'])('saves %s without rewriting any independent choice or input',policy=>{
  const s=base();s.domainSourcePalette={colors:['#80112233','#ff99aa00']};const before=JSON.stringify(s);
  const loaded=parseScene(JSON.stringify(withDomainRenderPolicy(s,policy)));
  expect(loaded.settings.domainRenderPolicy).toBe(policy);expect(unchanged(loaded)).toEqual(unchanged(s));expect(JSON.stringify(s)).toBe(before);
 });
 it.each([null,0,true,{},[], 'unknown'])('rejects a malformed policy at the document boundary: %j',raw=>{
  const value=JSON.parse(JSON.stringify(base()));value.settings.domainRenderPolicy=raw;expect(()=>parseScene(JSON.stringify(value))).toThrow();
 });
 it('enables failure recovery only for newly imported GPU source documents',()=>{
  for(const mode of ['CPU','GPU']){
   const raw={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Recovery import',settings:{render_mode:mode},domainColoring:{formula:'z'},palette:['#80112233','#ff123456']};
   const result=parseProjectFile('// actual file entry\n'+JSON.stringify(raw)),s=result.scene;
   expect(s.settings.domainRenderPolicy).toBe(mode==='GPU'?'source-cpu-on-gpu-failure-v1':undefined);expect(s.provenance?.original).toEqual(raw);
   expect(result.warnings.some(w=>w.includes('恢复策略为本地显式规则'))).toBe(mode==='GPU');
   expect(parseProjectFile(JSON.stringify(s)).scene).toEqual(s);
  }
 });
 it('does not materialize a fallback palette and preserves policy during independent version edits',()=>{
  const s=withDomainRenderPolicy(base(),'source-cpu-always-v1');expect(s.domainSourcePalette).toBeUndefined();
  const changed=withDomainViewportVersion(withDomainIterationVersion(withDomainColorVersion(s,'mathart-1.7.8-gpu'),'local-v1'),'mathart-1.7.8-gpu');
  expect(changed.settings.domainRenderPolicy).toBe('source-cpu-always-v1');expect(changed.settings.domainBackend).toBe('cpu');expect(changed.equations).toEqual(s.equations);
  const restored=withDomainRenderPolicy(changed,'selected-rules-1723');expect(unchanged(restored)).toEqual(unchanged(changed));
 });
 it('strips delivered execution facts from local import and persistence',()=>{
  const scene=base(),forged=Object.assign(scene,{domainRender:{route:'source-cpu-failure',constant:[99,99],sticky:true}});
  expect(Object.hasOwn(parseScene(JSON.stringify(forged)),'domainRender')).toBe(false);
  expect(Object.hasOwn(persistentScene(forged),'domainRender')).toBe(false);expect(Object.hasOwn(forged,'domainRender')).toBe(true);
 });
 it('forces the CPU triple while retaining a mixed authored triple, inactive next and constants',()=>{
  const scene=withDomainRenderPolicy(base(),'source-cpu-always-v1'),before=JSON.stringify(scene),out=generate(scene);
  expect(out.domainRender).toMatchObject({route:'source-cpu-forced',requested:{formula:'mathart-1.7.8-gpu',viewport:'local-v1',color:'local-v1',backend:'cpu'},effective:{formula:'mathart-1.7.8-cpu',viewport:'mathart-1.7.8-cpu',color:'mathart-1.7.8-cpu',backend:'cpu'},constant:[3,4]});
  expect(out.domainRender?.sourceConstantUpload).toBeUndefined();expect(JSON.stringify(scene)).toBe(before);
  const reference={...scene,settings:{...scene.settings,domainRenderPolicy:'selected-rules-1723',domainIterationVersion:'mathart-1.7.8-cpu',domainViewportVersion:'mathart-1.7.8-cpu',domainColorVersion:'mathart-1.7.8-cpu'}};
  expect(out.pixels).toEqual(generate(reference).pixels);
 });
 it('does not treat an explicit CPU backend as a GPU failure',()=>{
  const scene=withDomainRenderPolicy(base(),'source-cpu-on-gpu-failure-v1'),out=generate(scene);
  expect(out.domainRender).toMatchObject({route:'selected',effective:{formula:'mathart-1.7.8-gpu',viewport:'local-v1',color:'local-v1',backend:'cpu'},constant:[0,0]});
  expect(out.domainRender?.trigger).toBeUndefined();expect(out.domainRender?.sticky).toBe(false);
 });
 it('navigates and fits the delivered CPU view rather than the retained local choice',()=>{
  const scene=withDomainRenderPolicy(base(),'source-cpu-always-v1'),out=generate(scene),view=out.domainRender!.view;
  const nav=planeNavigation(scene,257,193,undefined,view);expect(nav.domainViewport).toBe(view);expect(nav.spanY).toBe(1);expect(fitPlane(scene,view).scale).toBe(2.5);expect(fitPlane(scene).scale).toBe(1);
  const pan=panPlane(nav,12,9),expected=[view.centerX+(-12/257*nav.spanX*view.cosine+9/193*nav.spanY*view.sine),view.centerY+(-12/257*nav.spanX*view.sine-9/193*nav.spanY*view.cosine)];
  expect(pan.centerX).toBeCloseTo(expected[0],14);expect(pan.centerY).toBeCloseTo(expected[1],14);
  const x=201,y=41,point=domainIdealPoint(x,y,257,193,view),zoom=zoomPlane(nav,x,y,-100);
  const after=generate({...scene,settings:{...scene.settings,...zoom}}).domainRender!.view;
  expect(domainIdealPoint(x,y,257,193,after)[0]).toBeCloseTo(point[0],13);expect(domainIdealPoint(x,y,257,193,after)[1]).toBeCloseTo(point[1],13);
 });
 it('renders completed facts and an independently editable source fallback palette',()=>{
  const scene=withDomainRenderPolicy(base(),'source-cpu-always-v1'),out=generate(scene),facts=out.domainRender as NonNullable<RasterOutput['domainRender']>;
  const html=renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(DomainColorControls,{scene,onChange:()=>{},renderFacts:facts,renderTime:1.5,onRetry:()=>{}})}));
  expect(html).toContain('domain-render-summary');expect(html).toContain('domain-effective-constant');expect(html).toContain('3 + (4)i');expect(html).toContain('1.500 s');expect(html).toContain('CPU recovery palette');expect(html).toContain('Source color');
  expect(scene.domainSourcePalette).toBeUndefined();expect(scene.settings.domainColorVersion).toBe('local-v1');
 });
});
