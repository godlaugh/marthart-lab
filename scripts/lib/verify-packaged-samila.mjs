import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodePng} from './verify-png.mjs';
import {inspectSourceFrameHeader} from '../../server/source-renderer.mjs';

/** Exercise the shipped app without modifying its source, RNG, or transport. */
export async function verifyPackagedSamila({fixture,page,ready,download,wire,pending,presents,out,enhanceSourcePausedImage,coldReplay}){
 const sha=b=>createHash('sha256').update(b).digest('hex'),raw=await readFile(fixture.path);assert.equal(sha(raw),fixture.sha256);
 const source=JSON.parse(raw),mark=wire.length;
 const waitDisplay=action=>Promise.race([Promise.all([page.waitForResponse(response=>{
  if(!response.url().endsWith('/api/source-renderer/frames'))return false;
  const p=inspectSourceFrameHeader(response.request().postDataBuffer());return p.ok&&p.value.family==='samila'&&p.value.operation===2;
 }),action()]),page.locator('.error-card').waitFor({state:'visible'}).then(async()=>{throw Error('Packaged Samila failed: '+await page.locator('.error-card').innerText());})]);
 const settle=async()=>{await ready();await Promise.all([...pending]);};
 const rows=start=>wire.slice(start).filter(r=>r.family==='samila');
 const creates=()=>wire.filter(r=>r.family==='samila'&&r.operation===1);
 await waitDisplay(()=>page.locator('input[type=file]').setInputFiles({name:fixture.name+'.json',mimeType:'application/json',buffer:raw}));
 await page.waitForFunction(name=>document.querySelector('.project-title')?.textContent.includes(name),source.name);await settle();
 assert(rows(mark).some(r=>r.operation===1),'Imported Samila did not create a native owner');assert(rows(mark).some(r=>r.operation===2),'Imported Samila did not display native pixels');
 const editor=page.getByRole('textbox',{name:'f₁(x, y)',exact:true}),beforeEquation=await editor.inputValue(),samilaEquation=`(${beforeEquation})+0.01`,applyMark=wire.length;
 await editor.fill(samilaEquation);await waitDisplay(()=>page.getByRole('button',{name:'Apply equations',exact:true}).click());await settle();
 const appliedCreates=rows(applyMark).filter(r=>r.operation===1);assert.equal(appliedCreates.length,1,'Full equation apply must create one new native owner');
 const owner=appliedCreates[0].resource,createCount=creates().length,input=page.locator('#param-'+fixture.parameter),before=await input.inputValue(),hotMark=wire.length;
 const primary=rows(applyMark).findLast(r=>r.operation===2);assert(primary);
 await waitDisplay(async()=>{await input.fill(String(Number(before)+fixture.delta));await input.blur();});await settle();
 const hot=rows(hotMark).filter(r=>r.operation===2);assert(hot.length>0);assert(hot.every(r=>r.resource===owner));assert.equal(creates().length,createCount);
 assert(hot.some(r=>r.steps===source.settings.batch_size*6),'Parameter change must perform six native sampling passes');
 const playMark=wire.length;await waitDisplay(()=>page.getByRole('button',{name:'Play',exact:true}).click());await page.getByRole('button',{name:'Pause',exact:true}).click();await settle();
 assert(rows(playMark).some(r=>r.operation===2&&r.resource===owner));assert.equal(creates().length,createCount);
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();const mode=page.getByRole('combobox',{name:'Samila image source',exact:true});assert.equal(await mode.inputValue(),'current');
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('160');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('120');await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');
 const exportImage=async(kind)=>{
  const begin=wire.length,file=await download(()=>page.getByRole('button',{name:'Start export',exact:true}).click());await page.getByRole('button',{name:'Start export',exact:true}).waitFor({state:'visible'});await Promise.all([...pending]);
  const png=decodePng(await readFile(file));assert.equal(png.width,160);assert.equal(png.height,120);
  const native=presents.findLast(p=>p.family==='samila'&&p.wire>=begin&&p.width===160&&p.height===120);assert(native,'Samila PNG lacks an actual native present');
  const expected=kind==='current'?enhanceSourcePausedImage(new Uint8ClampedArray(native.rgba),160,120):native.rgba;assert.deepEqual(png.rgba,Buffer.from(expected));
  await writeFile(`${out}/${fixture.name}-${kind}-native.rgba`,native.rgba);await writeFile(`${out}/${fixture.name}-${kind}-download.rgba`,png.rgba);
  return {file,rgbaSha256:sha(png.rgba),nativeWire:native.wire,completeRgbaExact:true,trace:rows(begin)};
 };
 const current=await exportImage('current');assert(current.trace.filter(r=>r.operation===2).length>=2,'Current capture must redraw export and primary');assert(current.trace.filter(r=>r.operation===2).every(r=>r.resource===owner));const restored=current.trace.findLast(r=>r.operation===2);assert.equal(restored.width,primary.width);assert.equal(restored.height,primary.height);
 const cold=[];
 if(coldReplay){
  await mode.selectOption('replay');
  for(let i=0;i<2;i++){
   const result=await exportImage('cold-'+i),made=result.trace.filter(r=>r.operation===1);assert.equal(made.length,1);assert.notEqual(made[0].resource,owner);assert(result.trace.some(r=>r.operation===4&&r.resource===made[0].resource));assert(result.trace.some(r=>r.operation===3&&r.resource===made[0].resource&&[1,2].includes(r.disposition)),'Cold native owner release must be acknowledged');cold.push(result);
  }
 }
 await page.getByRole('button',{name:'Close export',exact:true}).click();await settle();const afterColdCreates=creates().length,resumeMark=wire.length;
 await waitDisplay(()=>page.getByRole('button',{name:'Play',exact:true}).click());await page.getByRole('button',{name:'Pause',exact:true}).click();await settle();assert.equal(creates().length,afterColdCreates,'Cold export replaced the primary owner');
 assert(rows(resumeMark).some(r=>r.operation===2&&r.resource===owner),'Playback did not resume the original primary owner');
 await page.screenshot({path:out+'/'+fixture.name+'.png'});
 return {name:fixture.name,sourceSha256:fixture.sha256,nativeProfile:'samila',sourceEditing:{samilaEquation},baseBatch:source.settings.batch_size,primarySize:{width:primary.width,height:primary.height},hotParameter:{name:fixture.parameter,before,after:await input.inputValue(),sixPasses:true,sameOwner:true},current,coldReplay:coldReplay?{runs:cold,eachPngMatchesNative:true,independentOwners:true,releaseAcknowledged:true,primaryResumedWithoutRecreation:true,repeatEqualityClaimed:false}:undefined,limits:['Fresh Samila entropy is preserved; independent exports need not have equal pixels. Each download is compared with its own native response.','Packaged workflow coverage on this Mac, not new original parity or video verification.']};
}
