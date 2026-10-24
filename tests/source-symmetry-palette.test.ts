import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {Palette} from '../src/types';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {prepareSourceSymmetryPalette,sourceSymmetryPaletteLut} from '../src/engine/sourceSymmetryPalette';
import {DEFAULT_COSINE} from '../src/engine/palette';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/symmetry/palette-runtime.json',import.meta.url),'utf8')) as {cases:{id:string;document:Record<string,unknown>;offset?:number;cosine?:Palette['cosine'];expectedPalette:string[];lut:number[]}[]};
const load=(document:Record<string,unknown>)=>parseProjectFile(JSON.stringify({name:'Native palette',...document})).scene;
describe('Symmetry original runtime LUT through project import and local save/reopen',()=>{
 for(const row of fixture.cases)it(row.id,()=>{
  let scene=load(row.document);
  // These are explicit runtime edits in the JVM oracle, not file fields.
  if(row.offset!==undefined)scene.palette.offset=row.offset;
  if(row.cosine)scene.palette={...scene.palette,mode:'cosine',cosine:row.cosine};
  // Legacy local documents persist runtime palette extensions. New source
  // owner documents save the baked raw list (covered separately).
  delete scene.symmetrySourcePalette;delete scene.symmetryPaletteEditor;
  scene=parseScene(serializeScene(scene));
  const job=prepareIteratedFrame(scene,0,0),actual=sourceSymmetryPaletteLut(job.palette);
  expect(job.symmetryPalette).toEqual({model:'source-rgb1024',entries:1024,filter:'linear-repeat'});
  expect(Array.from(actual)).toEqual(row.lut);
  expect(scene.provenance?.original).toEqual({name:'Native palette',...row.document});
 });
 it.each([
  {cycles:2},{interpolation:'hsv'},{positions:[0,.25,1]},
  {mode:'hsv'},{mode:'sine'},
 ] as Partial<Palette>[])('keeps explicit local extension %j through save/reopen',extension=>{
  const scene=load(fixture.cases.find(r=>r.id==='rgb')!.document);
  delete scene.symmetrySourcePalette;delete scene.symmetryPaletteEditor;
  Object.assign(scene.palette,extension);
  const reopened=parseScene(serializeScene(scene));
  expect(reopened.palette).toMatchObject(extension);
  expect(prepareSourceSymmetryPalette(reopened.palette).model).toBe('local-rgba4097');
  expect(()=>sourceSymmetryPaletteLut(reopened.palette)).toThrow('本地扩展');
 });
 it('preserves the local document default coefficients shown by its editor',()=>{
  const row=fixture.cases.find(r=>r.id==='cosine-default')!,scene=load(row.document);
  scene.palette={...scene.palette,mode:'cosine',offset:row.offset!};
  expect(sourceSymmetryPaletteLut(scene.palette)).toEqual(sourceSymmetryPaletteLut({...scene.palette,cosine:DEFAULT_COSINE}));
 });
});
