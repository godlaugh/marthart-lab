import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProjectResolutionControls} from '../src/components/ProjectResolutionControls';
import {parseProjectResolution,PROJECT_RESOLUTION_MIN,PROJECT_RESOLUTION_MAX} from '../src/engine/projectResolution';
import {I18nProvider} from '../src/i18n';

describe('project resolution authoring surface',()=>{
 it('keeps omission in viewport mode without authoring a hidden default',()=>{
  const change=vi.fn(),html=renderToStaticMarkup(<ProjectResolutionControls onChange={change}/>);
  expect(html).toContain('value="viewport" selected=""');expect(html).not.toContain('aria-label="项目宽度"');
  expect(html).toMatch(/<button disabled="">应用项目尺寸<\/button>/);expect(change).not.toHaveBeenCalled();
 });
 it.each([{width:64,height:8192},{width:8192,height:64},{width:1920,height:1080}])('shows canonical authored dimensions without clamping or firing Apply: %j',raw=>{
  const resolution=parseProjectResolution(raw),change=vi.fn(),before=structuredClone(resolution);
  const html=renderToStaticMarkup(<ProjectResolutionControls resolution={resolution} onChange={change}/>);
  expect(html).toContain('value="fixed" selected=""');expect(html).toContain(`value="${raw.width}"`);expect(html).toContain(`value="${raw.height}"`);
  expect(html).toContain(`min="${PROJECT_RESOLUTION_MIN}" max="${PROJECT_RESOLUTION_MAX}" step="1"`);
  expect(html).toContain('type="number"');expect(html).not.toContain('type="range"');expect(html).toMatch(/<button disabled="">应用项目尺寸<\/button>/);
  expect(change).not.toHaveBeenCalled();expect(resolution).toEqual(before);
 });
 it('states aspect fitting and explicit re-generation in English without advertising physical DPI',()=>{
  const html=renderToStaticMarkup(<I18nProvider language="en"><ProjectResolutionControls resolution={{width:800,height:600}} onChange={()=>{}}/></I18nProvider>);
  expect(html).toContain('Fixed project dimensions');expect(html).toContain('Apply project dimensions');expect(html).toContain('Preview quality still determines sampling pixels');
  expect(html).not.toMatch(/[\u3400-\u9fff]/);expect(html).not.toContain('DPI');
 });
});
