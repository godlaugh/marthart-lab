import {useState,type ReactNode} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {usesSourceBouncing,parseSourceBouncingDocument,type SourceBouncingDocumentPayload} from '../engine/sourceBouncingDocument';
import {SOURCE_BOUNCING_POSITION_MODES,type SourceBouncingConfiguration,type SourceBouncingVelocityMode} from '../engine/sourceBouncingConfig';
import {sourceBouncingRadiansToDegrees,sourceBouncingDegreesToRadians} from './sourceBouncingAngles';
import {BouncingPolygonEditor} from './BouncingPolygonEditor';
import {SourceBouncingNumberField} from './SourceBouncingNumberField';
import {bouncingNumberRules} from './sourceBouncingNumbers';

type Props={scene:SceneDocument;onChange:(scene:SceneDocument)=>void;tab?:'geometry'|'appearance'};
type Commit=(text:string)=>string|undefined;
/** Uncontrolled draft survives validation errors and unrelated document edits.
 * A canonical value change replaces the input; no draft is stored in a scene. */
function DraftField({id,label,value,commit,multiline=false,numeric=false}:{id:string;label:string;value:string;commit:Commit;multiline?:boolean;numeric?:boolean}){
 const [error,setError]=useState('');
 const props={'data-testid':`source-bouncing-${id}`,'aria-label':label,'aria-invalid':!!error,defaultValue:value,onBlur:(event:{currentTarget:{value:string}})=>setError(commit(event.currentTarget.value)??''),onKeyDown:(event:{key:string;currentTarget:{blur:()=>void};ctrlKey:boolean;metaKey:boolean})=>{if(event.key==='Enter'&&(!multiline||event.ctrlKey||event.metaKey))event.currentTarget.blur();}};
 return <label className="field"><span>{label}</span>{multiline?<textarea key={value} {...props} rows={5}/>:<input key={value} {...props} type="text" inputMode={numeric?'decimal':undefined}/>} {error&&<span role="alert">{error}</span>}</label>;
}
const shapeNames:Record<SourceBouncingConfiguration['initialPositionMode'],string>={BOX:'矩形',CIRCLE:'圆形',HEART:'心形',INFINITY:'无穷形',RING:'圆环',SPIRAL:'螺旋',STAR:'星形',LISSAJOUS:'利萨如曲线',ROSE:'玫瑰曲线',SUPERELLIPSE:'超椭圆',HYPOCYCLOID:'内摆线',EPICYCLOID:'外摆线',ARCHIMEDEAN_SPIRAL:'矩形（ARCHIMEDEAN_SPIRAL）',FORMULA:'公式区域'};
const velocityNames:Record<SourceBouncingVelocityMode,string>={UNIFORM:'统一方向',RADIAL_OUT:'径向向外',RADIAL_IN:'径向向内',TANGENTIAL_CW:'顺时针切向',TANGENTIAL_CCW:'逆时针切向',RANDOM:'随机方向'};
/** Edits only canonical source payload. Native omission/provenance and dormant
 * shape fields survive changes; no local billiards or finite trail settings. */
export function SourceBouncingControls({scene,onChange,tab='geometry'}:Props){
 const {t}=useI18n(),[error,setError]=useState('');
 if(!usesSourceBouncing(scene)||!scene.bouncingSource)return null;
 const source=scene.bouncingSource,c=source.configuration,v=source.visual;
 const emit=(candidate:SourceBouncingDocumentPayload):string|undefined=>{
  const parsed=parseSourceBouncingDocument(candidate);
  if(!parsed.ok)return `${parsed.error.path.join('.')}: ${parsed.error.reason}`;
  onChange({...scene,bouncingSource:parsed.value});setError('');return undefined;
 };
 const text=(id:string,label:string,value:string,commit:Commit,multiline=false)=><DraftField key={id} id={id} label={t(label)} value={value} commit={commit} multiline={multiline}/>;
 const numberText=(value:number)=>Object.is(value,-0)?'-0':String(value);
 const commitNumber=(raw:string,accept:(n:number)=>string|undefined)=>{if(raw.trim()==='')return t('请输入数值');const n=Number(raw);if(!Number.isFinite(n))return t('请输入有限数值');return accept(n);};
 const number=(id:string,label:string,value:number,change:(n:number)=>SourceBouncingDocumentPayload)=><DraftField key={id} id={id} label={t(label)} value={numberText(value)} numeric commit={raw=>commitNumber(raw,n=>emit(change(n)))}/>;
 const configNumber=(key:{[K in keyof SourceBouncingConfiguration]:SourceBouncingConfiguration[K] extends number?K:never}[keyof SourceBouncingConfiguration],label:string)=>{
  const change=(n:number)=>({...source,configuration:{...c,[key]:n}});
  if(key==='particleCount'||key==='subSteps'||key==='timeStep'||key==='initialSpeed')return <SourceBouncingNumberField key={key} id={key} label={t(label)} value={c[key]} rules={bouncingNumberRules[key]} onCommit={n=>emit(change(n))}/>;
  return number(key,label,c[key],change);
 };
 const configDegrees=(key:'initialAngle'|'initialAngleSpread'|'shapeLissajousDelta',label:string)=><SourceBouncingNumberField key={key} id={key} label={t(label)} value={sourceBouncingRadiansToDegrees(c[key])} rules={bouncingNumberRules[key]} onCommit={n=>emit({...source,configuration:{...c,[key]:sourceBouncingDegreesToRadians(n)}})}/>;
 const select=(id:string,label:string,value:string,choices:readonly(readonly[string,string])[],change:(value:string)=>SourceBouncingDocumentPayload)=><label key={id} className="field"><span>{t(label)}</span><select data-testid={`source-bouncing-${id}`} aria-label={t(label)} value={value} onChange={event=>setError(emit(change(event.target.value))??'')}>{choices.map(([key,name])=><option key={key} value={key}>{t(name)}</option>)}</select></label>;
 const section=(id:string,label:string,children:ReactNode,open=true)=><details key={id} className="inspector-section" open={open}><summary>{t(label)}</summary><div className="section-body">{children}</div></details>;
 const mode=c.initialPositionMode,box=mode==='BOX'||mode==='ARCHIMEDEAN_SPIRAL';
 const json=(id:string,label:string,value:unknown,change:(value:unknown)=>SourceBouncingDocumentPayload)=>text(id,label,JSON.stringify(value,null,2),raw=>{let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return t('请输入有效的 JSON 数组');}return emit(change(parsed));},true);
 return <div key={scene.id} data-testid="source-bouncing-controls">
  <p className="muted">{t('源 GPU 弹跳模型 · 每个播放帧推进一次模拟；修改初始条件会重新播种。')}</p>
  {tab==='geometry'?<>
   {section('simulation','粒子模拟',<>
    {configNumber('particleCount','粒子数量')}
    {text('seed','64 位整数种子',c.seed,seed=>emit({...source,configuration:{...c,seed}}))}
    {configNumber('subSteps','每帧子步数')}{configNumber('timeStep','每帧物理步长')}{configNumber('particleRadius','碰撞半径')}
   </>)}
   {section('container','碰撞容器',<>
    {select('containerShape','容器形状',c.containerShape,[['POLYGON','多边形'],['CIRCLE','圆形'],['ELLIPSE','椭圆']],containerShape=>({...source,configuration:{...c,containerShape:containerShape as typeof c.containerShape}}))}
    {configNumber('boundaryCenterX','容器中心 X')}{configNumber('boundaryCenterY','容器中心 Y')}
    {c.containerShape==='CIRCLE'&&configNumber('circleRadius','容器半径')}
    {c.containerShape==='ELLIPSE'&&<>{configNumber('ellipseSemiMajorAxis','椭圆 X 半轴')}{configNumber('ellipseSemiMinorAxis','椭圆 Y 半轴')}</>}
    {c.containerShape==='POLYGON'&&<><BouncingPolygonEditor source={c} onApply={polygonVertices=>setError(emit({...source,configuration:{...c,polygonVertices}})??'')}/><details><summary>{t('高级顶点数据')}</summary>{json('polygonVertices','顶点坐标 [x, y, x, y, …]',c.polygonVertices,polygonVertices=>({...source,configuration:{...c,polygonVertices:polygonVertices as number[]}}))}</details><p className="muted">{t('按输入顺序连接并闭合，保留凹角、重复点和退化边。支持 3–64 个顶点。')}</p></>}
   </>)}
   {section('initial','初始位置',<>
    {select('initialPositionMode','初始形状',mode,SOURCE_BOUNCING_POSITION_MODES.map(key=>[key,shapeNames[key]]),initialPositionMode=>({...source,configuration:{...c,initialPositionMode:initialPositionMode as typeof mode}}))}
    {box?<>{configNumber('initialXMin','初始 X 下限')}{configNumber('initialXMax','初始 X 上限')}{configNumber('initialYMin','初始 Y 下限')}{configNumber('initialYMax','初始 Y 上限')}{mode==='ARCHIMEDEAN_SPIRAL'&&<p className="muted">{t('原版此选项使用矩形采样；螺旋采样请选择“螺旋”。')}</p>}</>:<>
     {configNumber('initialCircleCenterX','初始中心 X')}{configNumber('initialCircleCenterY','初始中心 Y')}{configNumber('initialCircleRadius','初始形状半径')}
     {select('shapeFillMode','形状采样',c.shapeFillMode,[['FILL','填充'],['OUTLINE','轮廓']],shapeFillMode=>({...source,configuration:{...c,shapeFillMode:shapeFillMode as typeof c.shapeFillMode}}))}
     {c.shapeFillMode==='OUTLINE'&&configNumber('shapeLineWidth','采样轮廓宽度')}
    </>}
    {(mode==='RING'||mode==='STAR')&&configNumber('shapeInnerRatio','内半径比例')}
    {mode==='STAR'&&configNumber('shapeNumPoints','星形角数')}
    {mode==='SPIRAL'&&<>{configNumber('shapeNumTurns','螺旋圈数')}{configNumber('shapeTightness','螺旋紧密度')}</>}
    {mode==='LISSAJOUS'&&<>{configNumber('shapeLissajousA','X 频率')}{configNumber('shapeLissajousB','Y 频率')}{configDegrees('shapeLissajousDelta','相位差（度）')}</>}
    {mode==='ROSE'&&configNumber('shapeRoseK','玫瑰系数 K')}
    {mode==='SUPERELLIPSE'&&configNumber('shapeSuperellipseN','超椭圆指数 N')}
    {(mode==='HYPOCYCLOID'||mode==='EPICYCLOID')&&configNumber('shapeK','摆线系数 K')}
    {mode==='FORMULA'&&<>{text('shapeFormula','采样区域公式',c.shapeFormula,shapeFormula=>emit({...source,configuration:{...c,shapeFormula}}),true)}<p className="muted">{t('公式使用世界坐标 x、y；遵循原版表达式与拒绝采样规则。')}</p></>}
   </>)}
   {section('velocity','初始速度',<>
    {select('initialVelocityMode','速度方向',c.initialVelocityMode,Object.entries(velocityNames),initialVelocityMode=>({...source,configuration:{...c,initialVelocityMode:initialVelocityMode as SourceBouncingVelocityMode}}))}
    {configNumber('initialSpeed','初始速率')}
    {c.initialVelocityMode!=='UNIFORM'&&c.initialVelocityMode!=='RANDOM'&&<>{configNumber('velocityCenterX','速度中心 X')}{configNumber('velocityCenterY','速度中心 Y')}</>}
    {c.initialVelocityMode!=='RANDOM'&&configDegrees('initialAngle','初始方向 / 零向量回退（度）')}
    {configDegrees('initialAngleSpread','方向散布（度）')}{configNumber('velocityNoise','方向噪声')}
   </>)}
  </>:<>
   {section('style','点与边界',<>
    {number('visual-dotSize','点大小',v.dotSize,dotSize=>({...source,visual:{...v,dotSize}}))}
    {number('visual-lineWeight','边界线宽',v.lineWeight,lineWeight=>({...source,visual:{...v,lineWeight}}))}
    {text('visual-boundaryColor','边界颜色',v.boundaryColor,boundaryColor=>emit({...source,visual:{...v,boundaryColor}}))}
    <p className="muted">{t('边界始终显示，透明度固定为 210/255。此模型不生成有限长度的粒子拖尾。')}</p>
    {text('visual-backgroundColor','背景颜色 #AARRGGBB','#'+v.backgroundColor.toString(16).padStart(8,'0'),raw=>{if(!/^#[0-9a-f]{8}$/i.test(raw.trim()))return t('请输入完整的 #AARRGGBB 颜色');return emit({...source,visual:{...v,backgroundColor:parseInt(raw.trim().slice(1),16)}});})}
   </>)}
   {section('palette','速度色板',<>
    {select('palette-kind','色板来源',v.palette.kind,[['absent','原版默认色板'],['colors','自定义色板']],kind=>({...source,visual:{...v,palette:kind==='absent'?{kind:'absent'}:{kind:'colors',colors:[]}}}))}
    {v.palette.kind==='colors'&&json('palette-colors','颜色文本数组',v.palette.colors,colors=>({...source,visual:{...v,palette:{kind:'colors',colors:colors as string[]}}}))}
    <p className="muted">{t('GPU 使用前 25 色；空数组使用白色。原始颜色文本按源规则解析，无法解析时使用白色。')}</p>
   </>)}
   {section('transform','显示变换',<>{(['X','Y','Z'] as const).map(axis=><div key={axis}>
    {number(`transform-scale${axis}`,`${axis} 缩放`,v.transform[`scale${axis}`],n=>({...source,visual:{...v,transform:{...v.transform,[`scale${axis}`]:n}}}))}
    {number(`transform-offset${axis}`,`${axis} 位移`,v.transform[`offset${axis}`],n=>({...source,visual:{...v,transform:{...v.transform,[`offset${axis}`]:n}}}))}
   </div>)}</>,false)}
   {section('camera','相机与录像',<>
    {(['phi','theta','gamma'] as const).map(key=>number(`camera-${key}`,`${key} 角度（弧度）`,source.camera[key],n=>({...source,camera:{...source.camera,[key]:n}})))}
    {number('recordDuration','源录像时长（秒）',source.recordDuration,recordDuration=>({...source,recordDuration}))}
    <p className="muted">{t('录像先绘制一个预热帧，再编码并检查时长；不会重置已显示的粒子状态。')}</p>
   </>)}
  </>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
