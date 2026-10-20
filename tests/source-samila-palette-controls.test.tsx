import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SourceSamilaPaletteEditor} from '../src/components/SourceSamilaPaletteEditor';
import {I18nProvider} from '../src/i18n';
import {parseProjectFile} from '../src/engine/legacyImport';
import {definition} from '../src/scenes';
import {visibleIteratedControls} from '../src/scenes/iteratedDensity';
describe('source Samila palette consumers',()=>{
 it('uses cosine priority consistently for loaded documents with an empty base palette',()=>{
  const scene=parseProjectFile('{"config_version":"1.0.0","type":"SAMILA","name":"Palette","palette":[]}').scene;
  scene.palette.mode='cosine';
  const html=renderToStaticMarkup(<I18nProvider language="en"><SourceSamilaPaletteEditor scene={scene} onChange={()=>{}}/></I18nProvider>);
  expect(html).toContain('value="cosine" selected');expect(html).toContain('A R');expect(html).not.toMatch(/[\u3400-\u9fff]/);
  expect(visibleIteratedControls(scene.kind,scene.settings,definition('samila').controls,scene.timeline,scene.palette).some(c=>c.key==='colorPhase')).toBe(false);
  expect(visibleIteratedControls(scene.kind,scene.settings,definition('samila').controls,scene.timeline,scene.palette).some(c=>c.key==='transparentBackground')).toBe(false);
  const legacy={...scene.settings};delete legacy.samilaPresentationModel;
  expect(visibleIteratedControls(scene.kind,legacy,definition('samila').controls,scene.timeline,scene.palette).some(c=>c.key==='transparentBackground')).toBe(true);
  scene.palette.mode='linear';
  expect(visibleIteratedControls(scene.kind,scene.settings,definition('samila').controls,scene.timeline,scene.palette).some(c=>c.key==='colorPhase')).toBe(true);
 });
});
