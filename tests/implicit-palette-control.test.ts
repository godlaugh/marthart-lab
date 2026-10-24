import {describe,it,expect} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {SceneDocument} from '../src/types';
import {SOURCE_IMPLICIT_PRESENTATION} from '../src/engine/sourceImplicitPresentation';
import {ImplicitPaletteControlOwner,prepareImplicitPalette,implicitPaletteControlReceiptMatches,validateImplicitPaletteControls,implicitPaletteControlRepresentationBytes,type ImplicitPaletteControls} from '../src/engine/implicitPaletteControl';
function scene(colors?:string[]):SceneDocument {
 const value=createScene(definition('implicit'));Object.assign(value.settings,{implicitPresentationVersion:SOURCE_IMPLICIT_PRESENTATION,renderMode:'mesh',computeBackend:'cpu'});
 if(colors!==undefined)value.implicitSourcePalette={colors};return value;
}
function setup(colors=['#80112233']){const author=scene(colors),owner=new ImplicitPaletteControlOwner('test');owner.commit(owner.prepare({acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:author}]}));return{author,owner};}
function hot(owner:ImplicitPaletteControlOwner,colors:string[]){owner.commit(owner.prepare({acknowledgedRevision:owner.receipt.revision,commands:[{kind:'palette',revision:owner.receipt.revision+1,colors}]}));}
describe('Implicit palette control cold/current worker authority',()=>{
 it('retains cold raw ARGB/invalid/decimal colors and uses the distinct opaque hot parser',()=>{
  const raw=['#80112233','0x112233','-1','invalid raw',' 112233'],{author,owner}=setup(raw);
  expect(owner.coldPalette.packed).toEqual([0x80112233,0xff112233,0xffffffff,0xffffffff,0xffffffff]);expect(owner.coldPalette.diagnostics).toHaveLength(2);
  hot(owner,raw);expect(owner.currentPalette.packed).toEqual([0xff112233,0xffffffff,0xffffffff,0xffffffff,0xffffffff]);expect(owner.currentScene.implicitSourcePalette!.colors).toEqual(['#ff112233','#ffffffff','#ffffffff','#ffffffff','#ffffffff']);
  expect(owner.coldScene.implicitSourcePalette!.colors).toEqual(raw);expect(author.implicitSourcePalette!.colors).toBe(raw);
  raw[0]='#000000';expect(owner.coldScene.implicitSourcePalette!.colors[0]).toBe('#80112233');
 });
 it('exposes format-specific preparation without pretending empty hot is cold white',()=>{
  expect(prepareImplicitPalette([],'cold').packed).toEqual([0xffffffff]);expect(prepareImplicitPalette([],'hot').packed).toEqual([]);expect(prepareImplicitPalette(['#80112233'],'cold').packed).toEqual([0x80112233]);expect(prepareImplicitPalette(['#80112233'],'hot').packed).toEqual([0xff112233]);expect(()=>prepareImplicitPalette([1],'cold')).toThrow('strings');
 });
 it('keeps cold empty and singleton authored cardinality, with white/constant runtime facts',()=>{
  const empty=setup([]).owner;expect(empty.coldScene.implicitSourcePalette!.colors).toEqual([]);expect(empty.currentPalette.packed).toEqual([0xffffffff]);
  const single=setup(['#00224466']).owner;expect(single.coldScene.implicitSourcePalette!.colors).toEqual(['#00224466']);expect(single.currentPalette.packed).toEqual([0x00224466]);
 });
 it('acknowledges empty hot commands without replacing current or resetting cold',()=>{
  const {owner}=setup();hot(owner,['#abcdef']);const current=owner.currentScene,palette=owner.currentPalette;
  hot(owner,[]);expect(owner.currentScene).toBe(current);expect(owner.currentPalette).toBe(palette);expect(owner.receipt).toEqual({revision:3,applyRevision:1,resetRevision:1});
 });
 it('falls back to legacy stops only when the raw source owner is omitted',()=>{
  const author=scene();author.palette.stops=['#123456','#abcdef'];const owner=new ImplicitPaletteControlOwner('legacy');owner.commit(owner.prepare({acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:author}]}));
  expect(owner.coldScene).not.toHaveProperty('implicitSourcePalette');expect(owner.currentPalette.packed).toEqual([0xff123456,0xffabcdef]);hot(owner,['#80fedcba']);expect(owner.currentScene.palette).toBe(owner.coldScene.palette);expect(owner.currentScene.implicitSourcePalette!.colors).toEqual(['#fffedcba']);
 });
 it('same-value Apply and ordered restart are events that restore the entire cold snapshot',()=>{
  const {owner}=setup(),cold=owner.coldScene;hot(owner,['#abcdef']);const prepared=owner.prepare({acknowledgedRevision:2,commands:[{kind:'apply',revision:3,scene:cold},{kind:'palette',revision:4,colors:['#123456']},{kind:'restart',revision:5}]});
  expect(prepared.steps.map(s=>[s.kind,s.reset])).toEqual([['apply',true],['palette',false],['restart',true]]);expect(prepared.current).toBe(prepared.cold);expect(prepared.palette.packed).toEqual([0x80112233]);owner.commit(prepared);expect(owner.receipt).toEqual({revision:5,applyRevision:3,resetRevision:3});expect(()=>owner.commit(prepared)).toThrow('stale');
 });
 it('record reset preserves consumed watermark so retries cannot reapply old hot colors',()=>{
  const {owner}=setup(),request:ImplicitPaletteControls={acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:['#fedcba']}]};owner.commit(owner.prepare(request));
  const reset=owner.prepareRecordingReset();expect(reset.current).toBe(owner.coldScene);expect(owner.currentScene).not.toBe(owner.coldScene);owner.commit(reset);expect(owner.currentPalette).toBe(owner.coldPalette);
  const retry=owner.prepare(request);expect(retry.steps).toEqual([]);owner.commit(retry);expect(owner.currentScene).toBe(owner.coldScene);expect(owner.receipt).toEqual({revision:2,applyRevision:1,resetRevision:2});
  hot(owner,['#fedcba']);expect(owner.currentPalette.packed).toEqual([0xfffedcba]);
 });
 it('holds immutable detached scenes/facts and rejects stale or foreign transactions',()=>{
  const {owner,author}=setup(),a=owner.prepare({acknowledgedRevision:1,commands:[{kind:'restart',revision:2}]}),b=owner.prepare({acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:['#123456']}]});
  expect(Object.isFrozen(a.current.settings)).toBe(true);expect(Object.isFrozen(a.palette.packed)).toBe(true);expect(Reflect.set(a.current.settings,'gamma',123)).toBe(false);author.settings.background='#ff0000';expect(owner.coldScene.settings.background).not.toBe('#ff0000');
  expect(()=>new ImplicitPaletteControlOwner('other').commit(a)).toThrow('another owner');owner.commit(b);expect(()=>owner.commit(a)).toThrow('stale');
 });
 it('rejects reused payloads, revision gaps, missing owner and illegal acknowledgement atomically',()=>{
  const {owner}=setup();const request:ImplicitPaletteControls={acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:['#123456']}]};owner.commit(owner.prepare(request));const before=owner.currentScene;
  expect(()=>owner.prepare({...request,commands:[{kind:'palette',revision:2,colors:['#654321']}]})).toThrow('reused');
  expect(()=>validateImplicitPaletteControls({acknowledgedRevision:1,commands:[{kind:'restart',revision:3}]})).toThrow('gap');expect(()=>owner.prepare({acknowledgedRevision:3,commands:[]})).toThrow('watermark');
  owner.commit(owner.prepare({acknowledgedRevision:2,commands:[]}));expect(()=>owner.prepare(request)).toThrow('watermark');expect(owner.currentScene).toBe(before);
  expect(()=>new ImplicitPaletteControlOwner('lost').prepare({acknowledgedRevision:2,commands:[]})).toThrow('Apply');expect(()=>new ImplicitPaletteControlOwner('first').prepare({acknowledgedRevision:0,commands:[{kind:'palette',revision:1,colors:[]}]})).toThrow('Apply');
 });
 it('distinguishes negative zero and user object shapes in exact Apply fingerprints',()=>{
  const author=scene();author.parameters.a=-0;const owner=new ImplicitPaletteControlOwner('zero'),request:ImplicitPaletteControls={acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:author}]};owner.commit(owner.prepare(request));
  const changed=structuredClone(author);changed.parameters.a=0;expect(()=>owner.prepare({...request,commands:[{kind:'apply',revision:1,scene:changed}]})).toThrow('reused');
  expect(owner.prepare(structuredClone(request)).steps).toEqual([]);
 });
 it('cancellation, malformed palette and expanded capacity rejection leave owner unchanged',()=>{
  const {owner}=setup(),before=owner.currentScene,receipt=owner.receipt;
  expect(()=>owner.prepare({acknowledgedRevision:1,commands:[{kind:'restart',revision:2}]},()=>true)).toThrow('cancelled');
  let checks=0;expect(()=>owner.prepare({acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:['#123456']}]},()=>++checks>=3)).toThrow('cancelled');
  expect(()=>owner.prepareRecordingReset(()=>true)).toThrow('cancelled');
  expect(()=>owner.prepare({acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:[null]}]} as unknown as ImplicitPaletteControls)).toThrow('strings');
  expect(()=>owner.prepare({acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:['x'.repeat(524289)]}]})).toThrow('1 MiB');
  let expanded:unknown={text:'x'.repeat(1024)};for(let i=0;i<20;i++)expanded={a:expanded,b:expanded};expect(()=>implicitPaletteControlRepresentationBytes(expanded)).toThrow('768');
  const candidate={...scene(),provenance:expanded} as SceneDocument;expect(()=>owner.prepare({acknowledgedRevision:1,commands:[{kind:'apply',revision:2,scene:candidate}]})).toThrow('768');
  const cyclic:{self?:unknown}={};cyclic.self=cyclic;expect(()=>implicitPaletteControlRepresentationBytes(cyclic)).toThrow();expect(owner.currentScene).toBe(before);expect(owner.receipt).toEqual(receipt);
 });
 it('rejects unrelated scene profiles and unknown control keys',()=>{
  const author=scene();author.settings.computeBackend='webgl2';expect(()=>validateImplicitPaletteControls({acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:author}]})).toThrow('CPU mesh');
  expect(()=>validateImplicitPaletteControls({acknowledgedRevision:0,commands:[],extra:true})).toThrow('Unknown');expect(()=>new ImplicitPaletteControlOwner('')).toThrow('identity');
 });
 it('matches receipt Apply/reset facts against actual commands and explicitly allows record resets',()=>{
  const first:ImplicitPaletteControls={acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:scene()},{kind:'palette',revision:2,colors:[]}]},prior={revision:2,applyRevision:1,resetRevision:1};
  expect(implicitPaletteControlReceiptMatches(prior,first)).toBe(true);expect(implicitPaletteControlReceiptMatches({...prior,applyRevision:2},first)).toBe(false);
  const reset={...prior,resetRevision:2},empty={acknowledgedRevision:2,commands:[]};expect(implicitPaletteControlReceiptMatches(reset,empty,prior)).toBe(false);expect(implicitPaletteControlReceiptMatches(reset,empty,prior,{allowRecordingResets:true})).toBe(true);
  expect(implicitPaletteControlReceiptMatches({revision:3,applyRevision:3,resetRevision:2},{acknowledgedRevision:2,commands:[{kind:'restart',revision:3}]})).toBe(false);
 });
});
