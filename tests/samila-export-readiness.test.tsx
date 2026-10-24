import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ExportDialog} from '../src/components/ExportDialog';
import {I18nProvider} from '../src/i18n';
import {parseLegacyScene} from '../src/engine/legacyImport';
const scene=parseLegacyScene('{"config_version":"1.0.0","type":"SAMILA","name":"Export readiness","settings":{"batch_size":4}}').scene;
describe('Samila export UI consumes preview readiness before enabling work',()=>{
 it.each([false,true])('gates the public export action on completed pause acknowledgement: %s',ready=>{
  const html=renderToStaticMarkup(<I18nProvider language="en"><ExportDialog scene={scene} time={.5} previewReady={ready} samilaPrimaryPixelHeight={972} samilaPixelDensity={1} currentSamilaCapture={{ready:true,size:{width:500,height:600},capture:async()=>{throw Error('SSR must not draw');}}} onClose={()=>{}} onDone={()=>{}}/></I18nProvider>);
  const button=[...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match=>match[0]).find(text=>text.includes('Start export'));
  expect(button).toBeDefined();expect(button!.includes('disabled=""')).toBe(!ready);expect(html.includes('Wait for the current preview to finish')).toBe(!ready);
 });
});
