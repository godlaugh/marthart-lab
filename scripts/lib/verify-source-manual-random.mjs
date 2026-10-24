import assert from 'node:assert/strict';

/** Public App interaction checks. The observer records generator arguments but
 * does not replace randomness, return values, document writes or rendering. */
export async function observeManualRandomRequests(context){
 await context.route('**/src/engine/sourceManualPaletteGeneration.ts',async route=>{
  const response=await route.fetch();let body=await response.text();
  for(const [name,args,statement] of [
   ['generateSourceManualPalette','request','window.__paletteAudit.requests.push(structuredClone(request));'],
   ['generateSourceManualMainTones','count','window.__paletteAudit.mainCalls.push(count);'],
  ]){
   const pattern=new RegExp(`function ${name}\\(${args},[^\\{]+\\{`);
   assert.ok(pattern.test(body),'Instrument the named actual generator entry: '+name);
   body=body.replace(pattern,match=>match+'\n'+statement);
  }
  await route.fulfill({response,body});
 });
}

export async function verifyManualRandom({page,check,palette,snapshot,ready,field,button,index,out}){
 const panel=page.getByTestId('source-manual-random');await panel.locator('summary').click();
 const strategy=page.getByRole('combobox',{name:'Random palette strategy',exact:true});
 const tone=i=>page.getByRole('textbox',{name:`Primary color ${i}`,exact:true});
 const count=field('random-count'),mainCount=field('random-main-count');
 const defaults=['#FF7A59','#F9C74F','#43AA8B','#577590'];
 const frameBefore=await snapshot(),before=await palette();
 const lastRequest=()=>page.evaluate(()=>window.__paletteAudit.requests.at(-1));
 const idle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const unchanged=async(label,expected=before)=>{await idle();assert.deepEqual(await palette(),expected);check(true,label);};
 const edit=async(input,value)=>{await input.fill(String(value));await input.blur();};
 async function generate(number,action=()=>button('Generate and replace palette').click()){
  const previous=await palette(),calls=await page.evaluate(()=>window.__paletteAudit.requests.length);
  await action();await page.waitForFunction(calls=>window.__paletteAudit.requests.length>calls,calls);
  await page.waitForFunction(previous=>{const c=window.__paletteAudit.calls.findLast(c=>c.input.quality!=='export');return c?.output&&JSON.stringify(c.scene.bouncingSource.visual.palette)!==JSON.stringify(previous);},previous);await ready();
  const actual=await palette();check(actual.kind==='colors'&&actual.colors.length===number&&actual.colors.every(c=>/^#[0-9A-F]{6}$/.test(c)),`Generate ${number} RGB colors through the actual App`);
  const current=await snapshot();assert.deepEqual(current.output.frame.checkpoint,frameBefore.output.frame.checkpoint);check(true,'Generation retains the full simulation checkpoint');
  return actual;
 }
 check(await count.inputValue()==='16'&&await strategy.inputValue()==='analogous','Random panel starts at original 16 colors and analogous strategy');
 await strategy.selectOption('split-complementary');check(await mainCount.inputValue()==='5','Split strategy starts at original five main tones');
 assert.deepEqual(await Promise.all([1,2,3,4,5].map(i=>tone(i).inputValue())),[...defaults,before.colors.at(-1)]);check(true,'Display derives only the missing fifth tone from the current palette');
 await unchanged('Opening and changing the strategy keeps all imported palette strings');
 let actual=await generate(16);assert.deepEqual((await lastRequest()).mainTones,defaults);check(true,'First split generation passes the raw four-tone draft, not its padded display');check(await page.getByRole('spinbutton',{name:'Bouncing color index',exact:true}).inputValue()==='1','Ordinary generation resets manual selection');
 check(actual.colors.length<before.colors.length,'Explicit generation replaces the complete imported palette including its tail');
 for(const [mode,n] of [['monochromatic',2],['analogous',6],['complementary',25]]){
  await strategy.selectOption(mode);await edit(count,n);await unchanged(`${mode} settings do not apply without Generate`,actual);
  actual=await generate(n);const request=await lastRequest();check(request.strategy===mode&&request.count===n&&request.mainTones===undefined,`${mode} uses its selected count without split main tones`);
 }
 await edit(count,100);check(await count.inputValue()==='25','Generation count clamps at 25');await edit(count,-4);check(await count.inputValue()==='2','Generation count clamps at 2');await edit(count,'invalid');check(await count.inputValue()==='2','Invalid count reverts to its last valid draft');await count.press('ArrowUp');check(await count.inputValue()==='3','Generation count increments by one');
 await strategy.selectOption('split-complementary');await edit(mainCount,100);check(await mainCount.inputValue()==='6','Main-tone count clamps at six');await edit(mainCount,1);check(await mainCount.inputValue()==='3','Main-tone count clamps at three');await edit(mainCount,6);await edit(count,16);
 await unchanged('Count limits and strategy edits do not rewrite the generated palette',actual);
 await index(4);actual=await generate(16,()=>button('Randomize primary colors and replace palette').click());
 const randomized=await Promise.all([1,2,3,4,5,6].map(i=>tone(i).inputValue()));assert.deepEqual((await lastRequest()).mainTones,randomized);check(randomized.every(c=>/^#[0-9A-F]{6}$/.test(c)),'Random primary colors update the draft and immediately apply it');check(await page.getByRole('spinbutton',{name:'Bouncing color index',exact:true}).inputValue()==='4','Randomizing main tones retains manual selection');
 await edit(mainCount,3);await edit(mainCount,6);assert.deepEqual(await Promise.all([1,2,3,4,5,6].map(i=>tone(i).inputValue())),randomized);check(true,'Shrinking and expanding count preserves the hidden raw main-tone tail');
 await tone(1).fill('#80123456');await tone(2).fill(' #GGGGGG ');await page.getByLabel('Primary color 3 RGB',{exact:true}).fill('#aabbcc');
 const edited=['#80123456',' #GGGGGG ','#AABBCC',...randomized.slice(3)];assert.deepEqual(await Promise.all([1,2,3,4,5,6].map(i=>tone(i).inputValue())),edited);check(true,'Main-tone raw text retains alpha/invalid whitespace while RGB edit formats only its target');
 await unchanged('Main-tone text and RGB edits are draft-only',actual);actual=await generate(16);assert.deepEqual((await lastRequest()).mainTones,edited);check(true,'Apply passes unnormalized draft strings to the source parser');
 await edit(mainCount,3);await tone(1).fill('#112233');await edit(mainCount,6);
 const derived=await Promise.all([1,2,3,4,5,6].map(i=>tone(i).inputValue()));assert.deepEqual(derived.slice(0,3),['#112233',...edited.slice(1,3)]);
 const F=Math.fround;assert.deepEqual(derived.slice(3),[3,4,5].map(i=>actual.colors[Math.floor(F(F(i/5)*(actual.colors.length-1))+.5)]));check(true,'Editing a shorter displayed main-tone list replaces only that draft; later padding derives from the current palette');
 await unchanged('Derived padding does not apply or mutate the work',actual);
 actual=await generate(16);assert.deepEqual((await lastRequest()).mainTones,['#112233',...edited.slice(1,3)]);check(true,'Derived main-tone padding remains separate from the raw generation request');
 await panel.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/random-palette-editor.png'});
 return actual.colors;
}
