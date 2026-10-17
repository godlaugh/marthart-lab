import {useState} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {FRACTAL_SOURCE_COLOR_PROFILE,FRACTAL_SOURCE_COLOR_ALGORITHMS,FRACTAL_SOURCE_COLOR_TRANSFERS,fractalSourceColorParameterDescriptors,fractalSourceColorRgbHex,withFractalSourceColorRgb,parseFractalSourceColorConfiguration,createDefaultFractalSourceColorConfiguration,type FractalSourceColorConfiguration,type FractalSourceColorParameterDescriptor} from '../engine/fractalSourceColor';
import {authoredFractalSourceColor,selectFractalColorProfile,usesFractalSourceColor} from '../engine/fractalSourceColorAuthoring';
import {FRACTAL_SOURCE_NUMERIC_PROFILE,parseFractalNumericProfile} from '../engine/fractalPrecision';
import {fractalViewportRules} from '../engine/complexViewport';

type Props={scene:SceneDocument;onChange:(scene:SceneDocument)=>void};
const algorithms:Record<string,string>={none:'零索引',basic:'基础',smooth_mandelbrot:'平滑迭代',decomposition:'角度分解',binary_decomposition:'二元分解',distance_estimator:'距离估计',direct_domain:'直接复域',direct_orbit_trap:'直接轨道陷阱',direct_normalized_z:'归一化复数',orbit_trap_index:'轨道陷阱索引'};
const transfers:Record<string,string>={none:'固定颜色',linear:'线性',sqr:'平方',sqrt:'平方根',cube:'立方',cuberoot:'立方根',log:'对数',exp:'指数',sin:'正弦',arctan:'反正切'};
const labels:Record<string,string>={metric:'度量',exponent:'指数',power:'幂次',bailout:'逃逸半径',type:'分解类型',scale:'尺度',gamma:'伽马',saturation:'饱和度',trap_radius:'陷阱半径',trap_shape:'陷阱形状',threshold:'陷阱阈值',trap_center_x:'陷阱中心实部',trap_center_y:'陷阱中心虚部',trap_angle:'陷阱角度',trap_aspect:'陷阱纵横比',mix_factor:'色板混合',merge_opacity:'叠加不透明度'};

function NumberField({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}){
 return <label className="field"><span>{label}</span><input aria-label={label} type="number" step="any" value={value} onChange={e=>{if(e.target.value!==''&&Number.isFinite(Number(e.target.value)))onChange(Number(e.target.value));}}/></label>;
}
function ColorText({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
 const {t}=useI18n();let rgb='#ffffff',error='';try{rgb=fractalSourceColorRgbHex(value);}catch(e){error=e instanceof Error?e.message:String(e);}
 return <div style={{display:'grid',gap:6}}><label className="field"><span>{label}</span><input aria-label={label} value={value} onChange={e=>onChange(e.target.value)}/></label><input type="color" aria-label={t('{label} RGB',{label})} value={rgb} onChange={e=>onChange(withFractalSourceColorRgb(value,e.target.value))}/>{error&&<p role="alert">{t(error)}</p>}</div>;
}

export function FractalColorProfileControl({scene,onChange}:Props){
 const {t}=useI18n(),source=usesFractalSourceColor(scene);
 return <details open className="inspector-section"><summary>{t('分形着色规则')}</summary><div className="section-body"><label className="field"><span>{t('分形着色版本')}</span><select aria-label={t('分形着色版本')} value={source?FRACTAL_SOURCE_COLOR_PROFILE:''} onChange={e=>onChange(selectFractalColorProfile(scene,e.target.value||undefined))}><option value="">{t('本地着色（保留旧作品）')}</option><option value={FRACTAL_SOURCE_COLOR_PROFILE}>{t('MathArt 1.7.8 原版着色')}</option></select></label><p className="muted">{t('首次选择使用原版默认颜色；切换保留两组设置和色板。')}</p></div></details>;
}

export function FractalSourceColorControls({scene,onChange}:Props){
 const {t}=useI18n(),[error,setError]=useState(''),color=authoredFractalSourceColor(scene);
 const sourceNumerics=fractalViewportRules(parseFractalNumericProfile(scene.settings.fractalNumericProfile),scene.settings.formula).sourceNewtonNova;
 const emit=(change:(copy:FractalSourceColorConfiguration)=>void)=>{try{const copy=structuredClone(color);change(copy);onChange({...scene,fractalSourceColor:parseFractalSourceColorConfiguration(copy)});setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}};
 const enable=(formula:'newton'|'nova')=>onChange({...scene,settings:{...scene.settings,formula,fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,...(scene.settings.fractalBackend==='cpu'?{fractalBackend:'auto'}:{})}});
 return <details open className="inspector-section" data-testid="fractal-source-color-controls"><summary>{t('原版内部与外部着色')}</summary><div className="section-body">
  {!sourceNumerics&&<div role="alert"><p>{t('原版着色需要 Newton 或 Nova 的原版数值规则。请选择对应公式后继续。')}</p><button onClick={()=>enable('newton')}>{t('使用 Newton 原版数值')}</button><button onClick={()=>enable('nova')}>{t('使用 Nova 原版数值')}</button></div>}
  {sourceNumerics&&scene.settings.fractalBackend==='cpu'&&<div role="alert"><p>{t('原版着色需要 WebGL2；当前 CPU 选择无法生成此画面。')}</p><button onClick={()=>onChange({...scene,settings:{...scene.settings,fractalBackend:'auto'}})}>{t('使用自动 GPU 后端')}</button></div>}
  {(['outside','inside'] as const).map(side=>{const style=color[side],region=t(side==='inside'?'内部':'外部');let descriptors:readonly FractalSourceColorParameterDescriptor[]=[];let invalid='';try{descriptors=fractalSourceColorParameterDescriptors(style.algorithm);}catch(e){invalid=e instanceof Error?e.message:String(e);}
   const field=(name:string)=>t('{region} · {label}',{region,label:t(name)});
   return <fieldset key={side}><legend>{region}</legend>
    <label className="field"><span>{t('着色算法')}</span><select aria-label={field('着色算法')} value={style.algorithm} onChange={e=>emit(c=>{c[side].algorithm=e.target.value;})}>{!FRACTAL_SOURCE_COLOR_ALGORITHMS.some(id=>id===style.algorithm)&&<option value={style.algorithm}>{style.algorithm}</option>}{FRACTAL_SOURCE_COLOR_ALGORITHMS.map(id=><option value={id} key={id}>{t(algorithms[id])}</option>)}</select></label>
    {invalid&&<p role="alert">{t(invalid)}</p>}
    {descriptors.map(d=>{const raw=style.parameters[d.key],value=raw??d.default,label=field(labels[d.key]??d.key),write=(v:number|string|[number,number])=>emit(c=>{c[side].parameters[d.key]=v;});
     return <div key={d.key} data-source-parameter={d.key}>
      {d.type==='select'?<label className="field"><span>{label}</span><select aria-label={label} value={String(value)} onChange={e=>write(e.target.value)}>{!d.choices!.includes(String(value))&&<option value={String(value)}>{String(value)}</option>}{d.choices!.map(v=><option key={v} value={v}>{t(v)}</option>)}</select></label>:d.type==='complex'?<>
       {raw!==undefined&&!Array.isArray(raw)&&<p className="muted">{t('保留的参数原文：{value}',{value:String(raw)})}</p>}
       {([0,1] as const).map(i=><NumberField key={i} label={t('{label} · {part}',{label,part:t(i===0?'实部':'虚部')})} value={Array.isArray(value)?value[i]:0} onChange={n=>{const pair:[number,number]=Array.isArray(value)?[value[0],value[1]]:[0,0];pair[i]=n;write(pair);}}/>)}
      </>:<label className="field"><span>{label}{d.unit==='degrees'&&` (${t('度')})`}</span><input aria-label={label} type="text" inputMode="decimal" value={String(value)} onChange={e=>write(e.target.value)}/></label>}
      {d.min!==undefined&&<small className="muted">{t('计算时下限：{value}',{value:String(d.min)})}</small>}{d.max!==undefined&&<small className="muted">{t('计算时上限：{value}',{value:String(d.max)})}</small>}
     </div>;
    })}
    <label className="field"><span>{t('传递函数')}</span><select aria-label={field('传递函数')} value={style.transfer} onChange={e=>emit(c=>{c[side].transfer=e.target.value;})}>{!FRACTAL_SOURCE_COLOR_TRANSFERS.some(id=>id===style.transfer)&&<option value={style.transfer}>{style.transfer}</option>}{FRACTAL_SOURCE_COLOR_TRANSFERS.map(id=><option value={id} key={id}>{t(transfers[id])}</option>)}</select></label>
    <NumberField label={field('颜色密度')} value={style.density} onChange={v=>emit(c=>{c[side].density=v;})}/><NumberField label={field('渐变偏移')} value={style.offset} onChange={v=>emit(c=>{c[side].offset=v;})}/>
    <label className="field toggle-field"><span>{t('重复渐变')}</span><input aria-label={field('重复渐变')} type="checkbox" checked={style.repeat} onChange={e=>emit(c=>{c[side].repeat=e.target.checked;})}/></label>
    <ColorText label={field('固定颜色原文')} value={style.solidColor} onChange={v=>emit(c=>{c[side].solidColor=v;})}/>
    {style.algorithm==='distance_estimator'&&<p role="status">{t(side==='inside'?'源规则下，内部距离着色索引为 0。':'Newton / Nova 的距离估计使用原版 Smooth 回退，并沿用距离算法参数。')}</p>}
   </fieldset>;
  })}
  <p className="muted">{t('参数原文保留；表达式与有效范围由原版规则解释。颜色文本保留 alpha，最终分形像素为不透明。')}</p>{error&&<p role="alert">{t(error)}</p>}
 </div></details>;
}

export function FractalSourcePaletteEditor({scene,onChange}:Props){
 const {t}=useI18n(),[selected,setSelected]=useState(0),[error,setError]=useState(''),color=authoredFractalSourceColor(scene),palette=color.palette,index=Math.min(selected,Math.max(0,palette.colors.length-1)),current=palette.colors[index];
 const emit=(change:(copy:FractalSourceColorConfiguration['palette'])=>void)=>{try{const copy=structuredClone(color);change(copy.palette);onChange({...scene,fractalSourceColor:parseFractalSourceColorConfiguration(copy)});setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}};
 return <div data-testid="fractal-source-palette" style={{display:'grid',gap:10}}>
  <p className="muted">{t('原版色板生成 1024 色纹理；本地色板保留，当前不参与着色。')}</p>
  <label className="field toggle-field"><span>{t('使用余弦色板')}</span><input type="checkbox" aria-label={t('使用余弦色板')} checked={palette.useCosine} onChange={e=>emit(p=>{p.useCosine=e.target.checked;})}/></label>
  <NumberField label={t('原版色板偏移')} value={palette.offset} onChange={v=>emit(p=>{p.offset=v;})}/>
  {palette.useCosine?<>{(['a','b','c','d'] as const).map(key=><fieldset key={key}><legend>{t('余弦参数 {name}',{name:key})}</legend>{([0,1,2] as const).map(i=><NumberField key={i} label={t('余弦 {name} · {channel}',{name:key,channel:['R','G','B'][i]})} value={palette.cosine[key][i]} onChange={v=>emit(p=>{p.cosine[key][i]=v;})}/>)}</fieldset>)}</>:<>
   <NumberField label={t('原版色板伽马')} value={palette.gamma} onChange={v=>emit(p=>{p.gamma=v;})}/>
   <label className="field"><span>{t('色板插值空间')}</span><select aria-label={t('色板插值空间')} value={palette.space} onChange={e=>emit(p=>{p.space=e.target.value as 'rgb'|'hsv';})}><option value="rgb">RGB</option><option value="hsv">HSV</option></select></label>
   <p>{t('已保存 {count} 个颜色',{count:palette.colors.length})}</p>
   {current!==undefined?<><label className="field"><span>{t('选择颜色')}</span><input type="number" aria-label={t('分形源颜色序号')} min={1} max={palette.colors.length} step={1} value={index+1} onChange={e=>{const v=Number(e.target.value);if(Number.isInteger(v)&&v>=1&&v<=palette.colors.length)setSelected(v-1);}}/></label><ColorText label={t('分形源颜色原文')} value={current} onChange={v=>emit(p=>{p.colors[index]=v;})}/><button onClick={()=>{emit(p=>{p.colors.splice(index,1);});setSelected(Math.max(0,index-1));}}>{t('删除颜色')}</button></>:<p role="status">{t('空原版色板使用黑色纹理。')}</p>}
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>{emit(p=>{p.colors.push(current??'#ffffff');});setSelected(palette.colors.length);}}>{t('添加颜色')}</button><button disabled={palette.colors.length<2} onClick={()=>{emit(p=>{p.colors.reverse();});setSelected(0);}}>{t('反转')}</button></div>
  </>}
  <button onClick={()=>{emit(p=>Object.assign(p,createDefaultFractalSourceColorConfiguration().palette));setSelected(0);}}>{t('恢复原版色板默认')}</button>
  {error&&<p role="alert">{t(error)}</p>}
 </div>;
}
