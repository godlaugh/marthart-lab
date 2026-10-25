import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodePng} from './verify-png.mjs';
import {inspectSourceFrameHeader} from '../../server/source-renderer.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

/** Check the packaged HTTP endpoint against independent recorded glyphs, then
 * import two caller-selected source projects differing only in formula flags. */
export async function verifyPackagedGlyph({page,ready,download,out,spec}){
 assert.deepEqual(spec.cases.map(c=>c.formulas),[true,false]);
 const referenceBytes=await readFile(spec.reference),reference=JSON.parse(referenceBytes);assert.equal(sha(referenceBytes),spec.referenceSha256);
 const report={referenceSha256:sha(referenceBytes),glyphs:[],images:[],errors:[]};
 const health=await page.evaluate(()=>fetch('/api/formula-glyph/health').then(r=>r.json()));assert.equal(health.available,true);report.health=health;
 for(const expected of reference.cases){
  const actual=await page.evaluate(async input=>{const r=await fetch('/api/formula-glyph',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const bytes=await r.arrayBuffer();return {status:r.status,width:Number(r.headers.get('x-glyph-width')),height:Number(r.headers.get('x-glyph-height')),identity:r.headers.get('x-glyph-renderer'),sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('')};},{latex:expected.latex,color:expected.color});
  assert.equal(actual.status,200);assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);assert.equal(actual.sha256,expected.rgbaSha256);assert.equal(actual.identity,health.rendererIdentity);report.glyphs.push({id:expected.id,...actual});
 }
 let stage,pixels,unlabelledInput;const pending=new Set(),glyphRequests=[];
 const observe=response=>{const task=(async()=>{
  if(response.url().endsWith('/api/formula-glyph')){glyphRequests.push({stage,status:response.status()});return;}
  if(!response.url().endsWith('/api/source-renderer/frames'))return;
  const parsed=inspectSourceFrameHeader(response.request().postDataBuffer());assert(parsed.ok);
  if(parsed.value.family||parsed.value.width!==320||parsed.value.height!==240)return;
  const bytes=await response.body();assert.equal(bytes.length,320*240*4);pixels={stage,sha256:sha(bytes)};
 })().catch(error=>report.errors.push(String(error)));pending.add(task);task.finally(()=>pending.delete(task));};
 page.on('response',observe);
 try{
  for(const fixture of spec.cases){
   stage=fixture.name;pixels=undefined;const raw=await readFile(fixture.path);assert.equal(sha(raw),fixture.sha256);const project=JSON.parse(raw),glyphStart=glyphRequests.length;
   assert.equal(project.main_equation.enabled,fixture.formulas);for(const formula of project.formulas??[])assert.equal(formula.enabled,fixture.formulas);
   const stripped=structuredClone(project);delete stripped.name;stripped.main_equation.enabled=false;for(const formula of stripped.formulas??[])formula.enabled=false;
   if(unlabelledInput)assert.deepEqual(stripped,unlabelledInput,'The paired inputs must differ only in name and formula visibility');else unlabelledInput=stripped;
   await page.locator('input[type=file]').setInputFiles({name:stage+'.json',mimeType:'application/json',buffer:raw});await page.waitForFunction(name=>document.querySelector('.project-title')?.textContent.includes(name),project.name);await ready();await page.locator('[data-testid=native-art-canvas]').waitFor({state:'visible'});await Promise.all([...pending]);
   if(fixture.formulas)assert(glyphRequests.slice(glyphStart).some(r=>r.stage===stage&&r.status===200),'Labelled UI did not request the packaged glyph service');
   await page.screenshot({path:out+'/'+stage+'-preview.png'});
   await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('320');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('240');await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');
   const file=await download(()=>page.getByRole('button',{name:'Start export',exact:true}).click());await Promise.all([...pending]);const png=decodePng(await readFile(file));assert.equal(png.width,320);assert.equal(png.height,240);assert.equal(pixels?.stage,stage,'No current native art export was observed');
   await writeFile(out+'/'+stage+'-export.rgba',png.rgba);report.images.push({name:stage,formulas:fixture.formulas,sourceSha256:fixture.sha256,file,artSha256:pixels.sha256,pngRgbaSha256:sha(png.rgba)});
   await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();
  }
  assert.equal(report.images.length,2);assert.equal(report.images[0].artSha256,report.images[1].artSha256,'Formula toggle changed the underlying art');assert.notEqual(report.images[0].pngRgbaSha256,report.images[1].pngRgbaSha256,'Formula pixels missing from the exported image');assert.deepEqual(report.errors,[]);report.status='passed';return report;
 }finally{page.off('response',observe);await Promise.all([...pending]);report.glyphRequests=glyphRequests;if(report.errors.length)report.status='failed';await writeFile(out+'/glyph-report.json',JSON.stringify(report,null,2)+'\n');assert.deepEqual(report.errors,[]);}
}
