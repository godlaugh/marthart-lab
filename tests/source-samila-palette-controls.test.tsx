import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SourceSamilaPaletteEditor} from '../src/components/SourceSamilaPaletteEditor';
import {I18nProvider,translate} from '../src/i18n';
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
  const controls=visibleIteratedControls(scene.kind,scene.settings,definition('samila').controls,scene.timeline,scene.palette);
  expect(controls.some(c=>c.key==='seed'||c.key==='funcSeed')).toBe(false);
  expect(controls.some(c=>c.key==='recordTrails')).toBe(false);
  expect(translate('en',controls.find(c=>c.key==='batchSize')!.help!)).not.toMatch(/[\u3400-\u9fff]/);
  const legacy={...scene.settings};delete legacy.samilaPresentationModel;
  delete legacy.samilaSamplingModel;
  expect(visibleIteratedControls(scene.kind,legacy,definition('samila').controls,scene.timeline,scene.palette).some(c=>c.key==='transparentBackground')).toBe(true);
  expect(visibleIteratedControls(scene.kind,legacy,definition('samila').controls,scene.timeline,scene.palette).some(c=>c.key==='seed')).toBe(true);
  scene.palette.mode='linear';
  expect(visibleIteratedControls(scene.kind,scene.settings,definition('samila').controls,scene.timeline,scene.palette).some(c=>c.key==='colorPhase')).toBe(true);
 });
});
