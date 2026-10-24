import {describe,it,expect,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SourceBouncingControls} from '../src/components/SourceBouncingControls';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {importSourceBouncingDocument} from '../src/engine/sourceBouncingDocument';
import {SOURCE_BOUNCING_POSITION_MODES} from '../src/engine/sourceBouncingConfig';
import type {SceneDocument} from '../src/types';
import originalAngles from './fixtures/source-bouncing-angle-controls/native.json';
import {sourceBouncingRadiansToDegrees,sourceBouncingDegreesToRadians} from '../src/components/sourceBouncingAngles';
const setter=vi.hoisted(()=>vi.fn());
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,setter],useRef:(initial:unknown)=>({current:initial}),useEffect:()=>{}}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(text:string)=>text})}));
type Node=ReactElement<Record<string,any>>;
function flatten(node:ReactNode):Node[]{if(Array.isArray(node))return node.flatMap(flatten);if(!isValidElement(node))return[];const e=node as Node;if(typeof e.type==='function')return flatten((e.type as(p:unknown)=>ReactNode)(e.props));return[e,...flatten(e.props.children)];}
function field(tree:ReactNode,id:string){const node=flatten(tree).find(n=>n.props['data-testid']===`source-bouncing-${id}`);expect(node,id).toBeDefined();return node!.props;}
function scene(){const s=createScene(definition('bouncing')),p=importSourceBouncingDocument({settings:{particle_count:4},palette:['#123456','#80112233']});if(!p.ok)throw Error('fixture');s.bouncingSource=p.value.payload;s.settings={};s.equations={};s.parameters={};s.timeline.tracks=[];return s;}
const blur=(tree:ReactNode,id:string,value:string)=>{const props=field(tree,id);if(props.value!==undefined)props.onChange?.({currentTarget:{value},target:{value}});props.onBlur({currentTarget:{value}});};
describe('source Bouncing canonical inspector',()=>{
 it('matches the original JVM inspector angle conversions, including signed zero and Float32 extremes',()=>{
  const fromBits=(bits:number)=>new Float32Array(new Uint32Array([bits]).buffer)[0],toBits=(value:number)=>new Uint32Array(new Float32Array([value]).buffer)[0];
  for(const row of originalAngles.cases){const convert=row.method==='degreesToRadians'?sourceBouncingDegreesToRadians:sourceBouncingRadiansToDegrees;expect(toBits(convert(fromBits(row.inputBits))),JSON.stringify(row)).toBe(row.outputBits);}
 });
 it('edits degrees while retaining radian storage and unchanged imported precision',()=>{
  const initial=scene(),onChange=vi.fn();initial.bouncingSource!.configuration.initialAngle=Math.fround(2.3456);
  const tree=<SourceBouncingControls scene={initial} onChange={onChange}/>,display=field(tree,'initialAngle').value;
  expect(display).toBe('134.4');expect(sourceBouncingDegreesToRadians(Number(display))).not.toBe(initial.bouncingSource!.configuration.initialAngle);
  field(tree,'initialAngle').onBlur({currentTarget:{value:display}});expect(onChange).not.toHaveBeenCalled();
  blur(tree,'initialAngle','45');expect(onChange.mock.lastCall![0].bouncingSource.configuration.initialAngle).toBe(Math.fround(Math.PI/4));
  blur(tree,'initialAngleSpread','450');expect(onChange.mock.lastCall![0].bouncingSource.configuration.initialAngleSpread).toBe(Math.fround(2*Math.PI));
  expect(initial.bouncingSource!.configuration.initialAngle).toBe(Math.fround(2.3456));
  onChange.mockClear();for(const raw of ['','not a number','Infinity','1e100']){blur(tree,'initialAngle',raw);expect(onChange).not.toHaveBeenCalled();expect(setter.mock.lastCall![0]).not.toBe('');}
 });
 it('commits valid drafts only on blur, preserving signed64 and unrelated canonical fields',()=>{
  const initial=scene(),before=structuredClone(initial),onChange=vi.fn(),tree=<SourceBouncingControls scene={initial} onChange={onChange}/>;
  expect(field(tree,'particleCount').onChange).toBeTypeOf('function');expect(field(tree,'particleCount').value).toBe('4');
  blur(tree,'particleCount','1234');expect(onChange.mock.lastCall![0].bouncingSource.configuration.particleCount).toBe(1234);
  blur(tree,'seed','-9223372036854775808');expect(onChange.mock.lastCall![0].bouncingSource.configuration.seed).toBe('-9223372036854775808');
  blur(tree,'timeStep','0.024');const next=onChange.mock.lastCall![0] as SceneDocument;
  expect(next.bouncingSource!.configuration.timeStep).toBe(Math.fround(.024));expect(next.settings).toEqual({});expect(next.bouncingSource!.visual).toEqual(before.bouncingSource!.visual);expect(initial).toEqual(before);
 });
 it('keeps invalid draft errors out of the document and uses canonical validation',()=>{
  const onChange=vi.fn(),tree=<SourceBouncingControls scene={scene()} onChange={onChange}/>;
  for(const [id,value]of [['particleCount','bad'],['particleCount',''],['subSteps','bad'],['seed','9223372036854775808'],['timeStep','Infinity'],['initialXMin','999'],['polygonVertices','[1,2,3]']]as const){blur(tree,id,value);expect(onChange).not.toHaveBeenCalled();expect(setter.mock.lastCall![0]).not.toBe('');}
  expect(field(tree,'particleCount').value).toBe('4');
 });
 it('uses integer truncation and inspector clamps before canonical conversion',()=>{
  const onChange=vi.fn(),tree=<SourceBouncingControls scene={scene()} onChange={onChange}/>;
  for(const [id,input,expected]of [['particleCount','3.9',3],['subSteps','17',16],['subSteps','0',1],['timeStep','0',Math.fround(.0001)],['timeStep','.3',.25],['initialSpeed','-1',0]]as const){blur(tree,id,input);expect(onChange.mock.lastCall![0].bouncingSource.configuration[id]).toBe(expected);}
 });
 it('exposes all source initialization modes with only their related shape fields',()=>{
  const expected:Partial<Record<typeof SOURCE_BOUNCING_POSITION_MODES[number],string[]>>={STAR:['shapeInnerRatio','shapeNumPoints'],RING:['shapeInnerRatio'],SPIRAL:['shapeNumTurns','shapeTightness'],LISSAJOUS:['shapeLissajousA','shapeLissajousB','shapeLissajousDelta'],ROSE:['shapeRoseK'],SUPERELLIPSE:['shapeSuperellipseN'],HYPOCYCLOID:['shapeK'],EPICYCLOID:['shapeK'],FORMULA:['shapeFormula']};
  for(const mode of SOURCE_BOUNCING_POSITION_MODES){const s=scene();s.bouncingSource!.configuration.initialPositionMode=mode;const tree=<SourceBouncingControls scene={s} onChange={()=>{}}/>,html=renderToStaticMarkup(tree);
   for(const option of SOURCE_BOUNCING_POSITION_MODES)expect(html).toContain(`value="${option}"`);
   for(const id of expected[mode]??[])field(tree,id);
   expect(html.includes('data-testid="source-bouncing-initialXMin"')).toBe(mode==='BOX'||mode==='ARCHIMEDEAN_SPIRAL');
   expect(html).not.toContain('data-testid="source-bouncing-shapeLineWidth"');
   if(mode!=='BOX'&&mode!=='ARCHIMEDEAN_SPIRAL'){s.bouncingSource!.configuration.shapeFillMode='OUTLINE';field(<SourceBouncingControls scene={s} onChange={()=>{}}/>,'shapeLineWidth');}
  }
 });
 it('preserves repeated and degenerate polygon vertices, while applying source Float32 ownership',()=>{
  const initial=scene(),onChange=vi.fn(),tree=<SourceBouncingControls scene={initial} onChange={onChange}/>;
  blur(tree,'polygonVertices','[0,0,0,0,2,0,1,0.1,0,2]');
  expect(onChange.mock.lastCall![0].bouncingSource.configuration.polygonVertices).toEqual([0,0,0,0,2,0,1,Math.fround(.1),0,2]);
  expect(onChange.mock.lastCall![0].bouncingSource.configuration.polygonSource).toBe(initial.bouncingSource!.configuration.polygonSource);
  field(tree,'containerShape').onChange({target:{value:'ELLIPSE'}});
  const ellipse=onChange.mock.lastCall![0] as SceneDocument,ellTree=<SourceBouncingControls scene={ellipse} onChange={onChange}/>;
  field(ellTree,'ellipseSemiMajorAxis');field(ellTree,'ellipseSemiMinorAxis');expect(renderToStaticMarkup(ellTree)).not.toContain('data-testid="source-bouncing-polygonVertices"');
 });
 it('keeps appearance ownership and source palette omission/empty distinctions',()=>{
  const initial=scene(),before=structuredClone(initial),onChange=vi.fn(),tree=<SourceBouncingControls scene={initial} onChange={onChange} tab="appearance"/>;
  for(const [id,text]of [['visual-dotSize','-2'],['visual-lineWeight','-.5'],['transform-scaleX','-3'],['camera-phi','0.5'],['recordDuration','1.25']]as const){blur(tree,id,text);expect(onChange.mock.lastCall![0].bouncingSource.configuration).toEqual(before.bouncingSource!.configuration);}
  blur(tree,'visual-backgroundColor','#80123456');expect(onChange.mock.lastCall![0].bouncingSource.visual.backgroundColor).toBe(0x80123456);
  blur(tree,'visual-boundaryColor','source-invalid-color');expect(onChange.mock.lastCall![0].bouncingSource.visual.boundaryColor).toBe('source-invalid-color');
  blur(tree,'palette-colors','[]');expect(onChange.mock.lastCall![0].bouncingSource.visual.palette).toEqual({kind:'colors',colors:[]});
  field(tree,'palette-kind').onChange({target:{value:'absent'}});expect(onChange.mock.lastCall![0].bouncingSource.visual.palette).toEqual({kind:'absent'});
  onChange.mockClear();blur(tree,'palette-colors','[42]');blur(tree,'visual-backgroundColor','#abc');blur(tree,'recordDuration','0');expect(onChange).not.toHaveBeenCalled();expect(initial).toEqual(before);
 });
 it('shows six velocity modes and separates the two tabs without old backend/trail controls',()=>{
  const onChange=vi.fn(),initial=scene(),tree=<SourceBouncingControls scene={initial} onChange={onChange}/>;
  const options=flatten(field(tree,'initialVelocityMode').children).filter(node=>node.type==='option');expect(options).toHaveLength(6);
  field(tree,'initialVelocityMode').onChange({target:{value:'RADIAL_IN'}});const next=onChange.mock.lastCall![0] as SceneDocument;
  field(<SourceBouncingControls scene={next} onChange={onChange}/>,'velocityCenterX');
  const geometry=renderToStaticMarkup(tree),appearance=renderToStaticMarkup(<SourceBouncingControls scene={initial} onChange={onChange} tab="appearance"/>);
  expect(geometry).toContain('源 GPU 弹跳模型');expect(geometry).not.toContain('source-bouncing-visual-dotSize');expect(appearance).not.toContain('source-bouncing-particleCount');
  for(const html of [geometry,appearance]){expect(html).not.toContain('value="cpu"');expect(html).not.toContain('type="checkbox"');}
  expect(renderToStaticMarkup(<SourceBouncingControls scene={createScene(definition('bouncing'))} onChange={onChange}/>)).toBe('');
 });
});
