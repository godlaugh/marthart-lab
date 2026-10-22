import {SourceFractalControls} from './SourceFractalControls';
import {useState} from 'react';
import {usesFractalSourceColor} from '../engine/fractalSourceColorAuthoring';
import {FractalColorProfileControl,FractalSourceColorControls} from './FractalSourceColorControls';
import type {ControlSpec,SceneDocument,Settings} from '../types';
import {definitions,fractalConfig} from '../scenes/complex';
import {visibleFractalControls as bulbControls} from '../scenes/mandelbulb';
import {parseFractalColors,fractalColorControls,fractalColorSettings,type FractalColorSide} from '../engine/fractalColor';
import {Control,SettingsFields} from './Fields';
import {PaletteEditor} from './PaletteEditor';
import {useI18n} from '../i18n';
import {usesStepConvergence,usesResidualConvergence,usesConvergenceExit} from '../engine/fractalConvergence';
import {parseFractalDistanceVersion} from '../engine/fractalDistance';
import {FRACTAL_SOURCE_NUMERIC_PROFILE,parseFractalNumericProfile} from '../engine/fractalPrecision';
import {fractalViewportRules} from '../engine/complexViewport';

/** The formula owner describes only inputs actually consumed by each recurrence. */
export function visible2DFractalControls(controls:ControlSpec[],s:Settings):ControlSpec[]{
 if(s.formula==='mandelbulb_3d')return bulbControls(controls,s);
 const f=String(s.formula??'mandelbrot'),julia=f==='julia'||s.variant==='julia',sourceNumerics=fractalViewportRules(parseFractalNumericProfile(s.fractalNumericProfile),f).sourceArithmetic;
 const specific:Record<string,boolean>={convergenceMode:!sourceNumerics&&['newton','nova','magnet1','magnet2','binocular'].includes(f),variant:!['julia','newton'].includes(f),power:['mandelbrot','julia','newton','nova','phoenix','spiral_septagon','binocular'].includes(f),powerImag:['mandelbrot','julia','newton','nova','phoenix'].includes(f)&&!(f==='phoenix'&&s.phoenixExponentMode==='rounded'),bailout:!['newton','nova','binocular'].includes(f),juliaReal:julia&&f!=='newton',juliaImag:julia&&f!=='newton',startReal:!julia&&!['newton','binocular'].includes(f),startImag:!julia&&!['newton','binocular'].includes(f),relaxation:['newton','nova','binocular'].includes(f),tolerance:['newton','nova','magnet1','magnet2','binocular'].includes(f),feedback:f==='phoenix',feedbackImag:f==='phoenix',phoenixPower2:f==='phoenix',phoenixExponentMode:f==='phoenix',singularityGuard:f==='spiral_septagon',quadReal:f==='binocular',quadImag:f==='binocular',constReal:f==='binocular',constImag:f==='binocular',z0Real:f==='binocular',z0Imag:f==='binocular',denomOffset:f==='binocular',perturbationPrecision:sourceNumerics||['mandelbrot','julia'].includes(f)&&Number(s.powerImag??0)===0&&Number.isInteger(s.power??2)};
 const mode=s.convergenceMode==='residual'?'residual':s.convergenceMode==='step'?'step':'legacy',sourceExit=usesConvergenceExit({formula:f,convergenceMode:mode});
 return controls.filter(c=>!c.key.startsWith('bulb')&&!['颜色','直接着色'].includes(c.group)&&(specific[c.key]??true)).map(c=>{
  if(sourceNumerics&&['power','powerImag','relaxation','tolerance'].includes(c.key))return {...c,min:undefined,max:undefined,...(c.key==='relaxation'?{label:'松弛系数'}:{})};
  if(sourceNumerics&&c.key==='perturbationPrecision'){const options=c.options!.filter(o=>['low','medium','high'].includes(o.value)),raw=String(s.perturbationPrecision??'high');return {...c,options:options.some(o=>o.value===raw)?options:[...options,{value:raw,label:raw}],help:'源规则只支持 low、medium、high；其他已保存精度保留，计算时明确报错。'};}
  if(c.key==='convergenceMode')return {...c,help:['magnet1','magnet2','binocular'].includes(f)?'选择收敛残差模式会启用独立内外着色，旧颜色外观可能改变。':c.help,options:[{value:'legacy',label:'兼容旧文档'},...(['newton','nova'].includes(f)?[{value:'step',label:'迭代步长与残差着色'}]:[{value:'residual',label:'收敛退出与残差着色'}])]};
  if((c.key==='relaxation'&&sourceExit&&f==='binocular')||(c.key==='tolerance'&&sourceExit)||(c.key==='bailout'&&mode==='residual'&&f.startsWith('magnet')))return {...c,min:0,max:undefined};
  return c.key==='power'&&f==='binocular'?{...c,min:2}:c.key==='relaxation'?{...c,label:'松弛系数'}:c;
 });
}
export function FractalControls({scene,onChange,onSourceChange,section='all'}:{scene:SceneDocument;onChange:(scene:SceneDocument)=>void;onSourceChange?:(scene:SceneDocument,intent?:'hot'|'apply'|'stage')=>void;section?:'formula'|'color'|'all'}) {
 const {t}=useI18n();
 if(scene.kind!=='fractal')return null;
 if(scene.fractalSource)return <SourceFractalControls scene={scene} onChange={onSourceChange??onChange} section={section}/>;
 const def=definitions.find(d=>d.kind==='fractal')!,s=scene.settings,numericProfile=parseFractalNumericProfile(s.fractalNumericProfile),sourceNumerics=fractalViewportRules(numericProfile,s.formula).sourceArithmetic;
 const changeNumericProfile=(value:string)=>{const profile=parseFractalNumericProfile(value),settings={...s};if(profile==='local-v1')delete settings.fractalNumericProfile;else settings.fractalNumericProfile=profile;onChange({...scene,settings});};
 const change=(key:string,value:number|string|boolean)=>{const settings={...s,[key]:value};if(key==='convergenceMode'&&value==='residual')settings.fractalColorVersion=2;if(key==='formula'&&value!==s.formula){if(numericProfile==='local-v1'&&(s.convergenceMode==='step'||s.convergenceMode==='residual'))settings.convergenceMode=['newton','nova'].includes(String(value))?'step':['magnet1','magnet2','binocular'].includes(String(value))?'residual':'legacy';if(settings.convergenceMode==='residual')settings.fractalColorVersion=2;if(value==='c_sin'){settings.startReal=Math.PI/2;settings.startImag=0;}if(value==='lambda'){settings.startReal=.5;settings.startImag=0;}}onChange({...scene,settings});};
 const mode=s.convergenceMode==='residual'?'residual':s.convergenceMode==='step'?'step':'legacy',formula=String(s.formula),activeMode=sourceNumerics?'step':usesConvergenceExit({formula,convergenceMode:mode})?mode:'legacy';
 return <>{section!=='color'&&s.formula!=='mandelbulb_3d'&&<details open className="inspector-section"><summary>{t('数值规则')}</summary><div className="section-body">
  <label className="field"><span>{t('Newton / Nova 数值规则')}</span><select aria-label={t('Newton / Nova 数值规则')} value={numericProfile} onChange={e=>changeNumericProfile(e.target.value)}><option value="local-v1">{t('本地数值规则（保留旧作品）')}</option><option value={FRACTAL_SOURCE_NUMERIC_PROFILE}>{t('MathArt 1.7.8 Newton / Nova')}</option></select></label>
  <p className="muted">{t('切换只改变数值规则；指数、种子、变体、收敛模式和后端选择保留。源规则的视口范围与纵向方向不同，画面可能改变。')}</p>
  {numericProfile===FRACTAL_SOURCE_NUMERIC_PROFILE&&(sourceNumerics?<><p role="status" className="fractal-source-numerics">{t('源规则使用 WebGL2 双 float 运算、源参考轨道和迭代步长退出；不能以 CPU 替代。Newton 固定使用参数平面，保留的 Julia 选择不参与计算；Nova 使用所选变体。')}</p><p className="muted">{t('原始阈值保留，计算时按源规则派生下限；Nova 还使用逻辑画布尺寸与缩放。此实现未验证原版应用帧缓冲或 DPI 像素一致性。')}</p>{s.fractalBackend==='cpu'&&<p role="alert">{t('当前选择 CPU；源 Newton/Nova 需要 WebGL2。请选择自动或 WebGL2 后端，或切回本地数值规则。')}</p>}</>:<p role="status">{t('当前公式不是 Newton 或 Nova；源数值规则暂不参与计算，所选规则仍随文档保存。')}</p>)}
 </div></details>}{section!=='color'&&<SettingsFields controls={visible2DFractalControls(def.controls,s)} settings={{...s,convergenceMode:activeMode}} onChange={change}/>} {section!=='color'&&!sourceNumerics&&['newton','nova'].includes(String(s.formula))&&s.convergenceMode==='step'&&<p className="section-body muted">{t('按每步位移判断收敛，收敛点使用外部着色。独立着色的 Smooth 使用残差平滑；此模式暂用 CPU；Nova 阈值还随缩放和输出分辨率自动调整。')}</p>} {section!=='color'&&usesResidualConvergence({formula,convergenceMode:mode})&&<p className="section-body muted">{t('收敛点使用外部着色，保留停止距离与着色残差。Magnet I 按源着色器使用零残差，Magnet II 与 Binocular 使用各自的距离；零 Magnet 阈值关闭收敛。GPU 按数值能力计算，不确定像素回退 CPU。')}</p>} {section!=='formula'&&<><FractalColorProfileControl scene={scene} onChange={onChange}/>{usesFractalSourceColor(scene)?<FractalSourceColorControls scene={scene} onChange={onChange}/>:<LocalFractalColorBody scene={scene} onChange={onChange} change={change} activeMode={activeMode}/>}</>}</>;
}

/** Local color parsing stays inside its active branch; dormant local values do
 * not constrain source-color authoring or the formula-only panel. */
function LocalFractalColorBody({scene,onChange,change,activeMode}:{scene:SceneDocument;onChange:(scene:SceneDocument)=>void;change:(key:string,value:number|string|boolean)=>void;activeMode:'legacy'|'step'|'residual'}){
 const {t}=useI18n(),[side,setSide]=useState<FractalColorSide>('outside'),s=scene.settings,def=definitions.find(d=>d.kind==='fractal')!;
 let error='',colors,sourceDistance=false,distanceCapability;try{sourceDistance=parseFractalDistanceVersion(s.fractalDistanceVersion)!==undefined;colors=parseFractalColors(scene);}catch(e){error=String(e);colors=parseFractalColors({...scene,settings:def.defaults.settings});}
 if(sourceDistance&&!error)try{distanceCapability=fractalConfig(s).distance?.capability;}catch(e){error=String(e);}
 const changeDistanceVersion=(value:string)=>{const settings={...s};if(value==='')delete settings.fractalDistanceVersion;else{settings.fractalDistanceVersion=value;settings.fractalColorVersion=2;}onChange({...scene,settings});};
 const style=colors[side],values={...fractalColorSettings(style),...s};
 return s.formula!=='mandelbulb_3d'&&<details open className="inspector-section"><summary>{t('内部与外部着色')}</summary><div className="section-body">
  {error&&<p role="alert">{t(error)}</p>}
  <label className="field"><span>{t('距离估计规则')}</span><select aria-label={t('距离估计规则')} value={sourceDistance?'mathart-1.7.8-v1':''} onChange={e=>changeDistanceVersion(e.target.value)}><option value="">{t('兼容已保存文档（2097）')}</option><option value="mathart-1.7.8-v1">{t('MathArt 1.7.8 距离估计')}</option></select></label>
  <p className="muted">{t('源距离估计规则会启用独立内外着色；原算法、参数和色板保留。切换可能改变颜色，兼容模式保留旧计算行为。')}</p>
  {colors.version===1?<><p>{t('此文档保留旧颜色映射。升级后可独立编辑内部和外部，颜色外观可能改变。')}</p><button onClick={()=>onChange({...scene,settings:{...s,fractalColorVersion:2,...fractalColorSettings(colors.inside),...fractalColorSettings(colors.outside)}})}>{t('启用独立着色')}</button></>:<>
   <label className="field"><span>{t('着色区域')}</span><select aria-label={t('着色区域')} value={side} onChange={e=>setSide(e.target.value as FractalColorSide)}><option value="outside">{t('外部')}</option><option value="inside">{t('内部')}</option></select></label>
   {fractalColorControls(style,usesStepConvergence({formula:String(s.formula),convergenceMode:activeMode}),sourceDistance).map(spec=><Control key={spec.key} spec={spec} value={values[spec.key]} onChange={v=>change(spec.key,v)}/>)}
   {style.algorithm==='distance_estimator'&&(sourceDistance?side==='inside'?<p role="status" className="fractal-distance-inside">{t('源规则下，内部距离着色索引为 0。')}</p>:distanceCapability&&!distanceCapability.supported&&<p role="status" className="fractal-distance-fallback">{t('当前公式不满足源距离估计条件，实际使用 Smooth；保留 Distance Estimator 选择与参数。')}{' '}{t(distanceCapability.reason==='formula-type'?'当前公式类型不支持距离估计。':distanceCapability.reason==='complex-power'?'复数指数不支持源距离估计。':distanceCapability.reason==='non-integer-power'?'非整数指数不支持源距离估计。':'当前递推公式不支持源距离估计。')}{' '}{t('回退沿用距离着色幂次，不读取未启用的 Smooth 参数。')}</p>:!['mandelbrot','julia'].includes(String(s.formula))&&<p role="alert">{t('距离估算仅支持 Mandelbrot / Julia 幂函数族')}</p>)}
   {(style.algorithm!=='none'&&(!style.algorithm.startsWith('direct_')||style.algorithm==='direct_orbit_trap'))&&<>
    <label className="field toggle-field"><span>{t('此区域使用独立色板')}</span><input aria-label={t('此区域使用独立色板')} type="checkbox" checked={s[side+'Palette']!==undefined} onChange={e=>{const settings={...s};if(e.target.checked)settings[side+'Palette']=JSON.stringify(scene.palette);else delete settings[side+'Palette'];onChange({...scene,settings});}}/></label>
    {s[side+'Palette']!==undefined?<PaletteEditor key={side} palette={style.palette} onChange={palette=>change(side+'Palette',JSON.stringify(palette))}/>:<p>{t('继承共享色板；此区域的密度与偏移独立。')}</p>}
   </>}
  </>}
 </div></details>;
}
