import {mapDimension} from '../engine/mapDimension';
import {useI18n} from '../i18n';
import {useEffect,useRef,useState} from 'react';
import {RotateCcw,Sparkles} from 'lucide-react';
import type {SceneDocument} from '../types';
import {Generator} from '../engine/client';
import type {StableSearchProgress} from '../engine/stableSearch';
import {DOMAIN_TEMPLATES,exploreDomain} from '../engine/explore';
import {exploreSurface} from '../engine/surfaceExplore';
import {exploreSamila,randomizeSamilaParameters} from '../scenes/samila';
import {exploreMap,exploreSymmetry,type SymmetryProfile,type SymmetryExploration} from '../scenes/iterated';
import {DOMAIN_FORMULA_FAMILIES,ROOT_EXPLORER_STYLES,type ComplexExploreProgress,type RootsExploreOptions,type DomainFormulaFamily} from '../engine/complexExplore';
import {explorePerlin,type PerlinRandomIntensity} from '../scenes/perlinExplore';
import {parameterSamplingRanges} from '../engine/parameterEditing';
import {hasSymmetryCustom} from '../engine/symmetryCustom';

/** These are the authored fields exploration may replace. The same projection
 * owns change detection and restoration, including an omitted source payload. */
function explorationInputs(scene:SceneDocument){return{equations:scene.equations,parameters:scene.parameters,settings:scene.settings,...(scene.rootsMath?{rootsMath:scene.rootsMath}:{})};}
export function explorationBaselineChanged(scene:SceneDocument,baseline:SceneDocument):boolean{return JSON.stringify(explorationInputs(scene))!==JSON.stringify(explorationInputs(baseline));}
export function restoreExplorationBaseline(scene:SceneDocument,baseline:SceneDocument):SceneDocument{
 const next={...scene,...structuredClone(explorationInputs(baseline))};
 if(!baseline.rootsMath)delete next.rootsMath;
 return next;
}

export function ExplorePanel({scene,onChange}:{scene:SceneDocument;onChange:(next:SceneDocument)=>void}){
  const {t}=useI18n();
  const baseline=useRef<SceneDocument|null>(null),worker=useRef<Generator|null>(null),sceneId=useRef(scene.id);
  const latestScene=useRef(scene);latestScene.current=scene;
  const [searching,setSearching]=useState(false),[message,setMessage]=useState(''),[progress,setProgress]=useState<StableSearchProgress|null>(null),[template,setTemplate]=useState('soft-phase'),[seed,setSeed]=useState(Number(scene.settings.explorationSeed??scene.settings.funcSeed??42)>>>0),[attempts,setAttempts]=useState(60);
  const [complexProgress,setComplexProgress]=useState<ComplexExploreProgress|null>(null),[domainMode,setDomainMode]=useState<'curves'|'formula'>('curves'),[family,setFamily]=useState<DomainFormulaFamily>('AUTO'),[rootOptions,setRootOptions]=useState<Omit<RootsExploreOptions,'kind'|'seed'>>({style:'RADIAL_BLOOM',maxDegree:18,termCount:5,parameterCount:2,parameterDomain:'UNIT_CIRCLE',candidateCount:12}),[perlinIntensity,setPerlinIntensity]=useState<PerlinRandomIntensity>('balanced');
  useEffect(()=>{sceneId.current=scene.id;baseline.current=null;worker.current?.dispose();worker.current=null;setSearching(false);setMessage('');setProgress(null);},[scene.id]);
  useEffect(()=>()=>worker.current?.dispose(),[]);
  useEffect(()=>{if(worker.current){worker.current.cancel();worker.current=null;setSearching(false);setMessage('场景已更改，旧探索已取消。');}},[scene]);
  if(!['surface','attractor','domain','roots','perlin','samila','map','symmetry'].includes(scene.kind))return null;
  const customSymmetry=hasSymmetryCustom(scene);
  const changed=baseline.current&&explorationBaselineChanged(scene,baseline.current);
  async function explore(action:'random'|'deep'='random'){
    if(customSymmetry){setMessage('自定义 GLSL 不能使用内置模板的轨迹筛选；请先切换为模板公式。');return;}
    baseline.current??=structuredClone(scene);
    setMessage('');
    if(scene.kind==='perlin'){
      try{const result=explorePerlin(scene.settings,seed,{action,intensity:perlinIntensity});onChange({...scene,settings:result.settings});setSeed((seed+1)>>>0);setMessage(`已应用 ${result.changed.length} 项变化，检查 ${result.candidates} 个候选。${result.warnings.join(' ')}`);}catch(error){setMessage(String(error));}return;
    }
    if(scene.kind==='roots'||scene.kind==='domain'&&domainMode==='formula'){
      const g=new Generator();worker.current?.dispose();worker.current=g;setSearching(true);setComplexProgress(null);
      try{
        const options=scene.kind==='roots'?{...rootOptions,kind:'roots' as const,seed}:{kind:'domain' as const,seed,family,candidateCount:12};
        const result=await g.exploreComplex(scene,options,setComplexProgress);
        if(latestScene.current!==scene)return;
        if(result.scene){onChange(result.scene);setMessage(`检查 ${result.attempted} 个候选，${result.accepted} 个通过筛选；已应用最佳结果。${result.warnings.join(' ')}`);}
        else setMessage(result.status==='cancelled'?'搜索已取消':'本轮没有通过数值筛选的候选，请更换种子或探索选项。');
        setSeed((seed+1)>>>0);
      }catch(error){if(latestScene.current===scene)setMessage(error instanceof Error&&error.name==='AbortError'?'搜索已取消':String(error));}
      finally{g.dispose();if(worker.current===g){worker.current=null;setSearching(false);}}
      return;
    }
    if(scene.kind==='map'||scene.kind==='symmetry'){
      try{
        const result=scene.kind==='map'?exploreMap(seed,{x:scene.equations.x,y:scene.equations.y,z:scene.equations.z},scene.parameters,{dimension:mapDimension(scene.settings)}):exploreSymmetry(seed,{customGlsl:scene.equations.glsl,profile:String(scene.settings.explorationProfile??'any') as SymmetryProfile,...(scene.settings.lockDegree?{degree:Number(scene.settings.degree??5)}:{}),template:scene.settings.template==='modified'?'modified':'standard'});
        onChange({...scene,parameters:result.parameters,settings:{...scene.settings,...('settings' in result?result.settings as SymmetryExploration['settings']:{}),explorationSeed:seed}});setSeed((seed+1)>>>0);setMessage(`已应用新的参数组合，${result.acceptedCandidates} / ${result.candidates} 个候选通过轨迹检查。`);
      }catch(error){setMessage(String(error));}return;
    }
    if(scene.kind==='surface'){
      try{const result=exploreSurface(scene,seed);if(result.equations){onChange({...scene,equations:result.equations});setMessage('已应用通过几何筛选的相近公式');}else setMessage(result.reason??'没有找到可用的局部变体');setSeed((seed+1)>>>0);}catch(error){setMessage(String(error));}return;
    }
    if(scene.kind==='samila'){
      try{const result=exploreSamila(seed);onChange({...scene,equations:result.equations,parameters:result.parameters,settings:{...scene.settings,mapping:result.mapping,projection:result.projection,funcSeed:seed}});setSeed((seed+1)>>>0);setMessage(`已应用新的显式方程，${result.acceptedCandidates} / ${result.candidates} 个候选通过检查。`);}catch(error){setMessage(String(error));}return;
    }
    if(scene.kind==='domain'){
      onChange(exploreDomain(scene,template,seed));setSeed((seed+1)>>>0);setMessage('已生成新的等值线组合');return;
    }
    const id=scene.id,g=new Generator();worker.current?.dispose();worker.current=g;setSearching(true);setProgress(null);
    try{
      const result=await g.searchStable(scene,{seed,attempts},setProgress);
      if(sceneId.current!==id||latestScene.current!==scene)return;
      if(result.candidate){onChange({...scene,parameters:result.candidate.parameters});setMessage(`完成 ${result.attempts} 个候选，${result.accepted} 个通过筛选；已应用得分最高的参数。`);}
      else setMessage(result.status==='cancelled'?'搜索已取消':'本轮未找到通过筛选的候选，可更换种子继续。');
      setSeed((seed+1)>>>0);
    }catch(error){if(sceneId.current===id)setMessage(error instanceof Error&&error.name==='AbortError'?'搜索已取消':String(error));}
    finally{g.dispose();if(worker.current===g){worker.current=null;setSearching(false);}}
  }
  return <details open className="inspector-section"><summary>{t("随机探索")}</summary><div className="section-body">
    {scene.kind==='domain'&&<><label className="field"><span>{t("探索内容")}</span><select aria-label={t("探索内容")} value={domainMode} disabled={searching} onChange={e=>setDomainMode(e.target.value as 'curves'|'formula')}><option value="curves">{t("等值线组合")}</option><option value="formula">{t("复函数公式")}</option></select></label>{domainMode==='curves'?<label className="field"><span>{t("探索模板")}</span><select aria-label={t("探索模板")} value={template} onChange={e=>setTemplate(e.target.value)}>{DOMAIN_TEMPLATES.map(([id,label])=><option key={id} value={id}>{t(label)}</option>)}</select></label>:<label className="field"><span>{t("公式家族")}</span><select aria-label={t("公式家族")} value={family} disabled={searching} onChange={e=>setFamily(e.target.value as DomainFormulaFamily)}>{DOMAIN_FORMULA_FAMILIES.map(([id,label])=><option key={id} value={id}>{t(label)}</option>)}</select></label>}</>}
    {scene.kind==='roots'&&<><label className="field"><span>{t("探索风格")}</span><select aria-label={t("探索风格")} disabled={searching} value={rootOptions.style} onChange={e=>setRootOptions(o=>({...o,style:e.target.value as RootsExploreOptions['style']}))}>{ROOT_EXPLORER_STYLES.map(([id,label])=><option key={id} value={id}>{t(label)}</option>)}</select></label>{([['maxDegree',t("最高次数"),4,36],['termCount',t("公式项数"),3,Math.min(10,(rootOptions.maxDegree??18)+1)],['parameterCount',t("变化因子数量"),1,3],['candidateCount',t("探索候选数量"),1,24]] as const).map(([key,label,min,max])=><label className="field" key={key}><span>{t(label)}</span><input aria-label={t(label)} disabled={searching} type="number" min={min} max={max} step={1} value={rootOptions[key]} onChange={e=>{const value=Number(e.target.value);if(Number.isInteger(value)&&value>=min&&value<=max)setRootOptions(o=>({...o,[key]:value,...(key==='maxDegree'?{termCount:Math.min(o.termCount??5,value+1)}:{})}));}}/></label>)}<label className="field"><span>{t("探索采样域")}</span><select aria-label={t("探索采样域")} disabled={searching} value={rootOptions.parameterDomain} onChange={e=>setRootOptions(o=>({...o,parameterDomain:e.target.value as RootsExploreOptions['parameterDomain']}))}><option value="UNIT_CIRCLE">{t("单位圆")}</option><option value="REAL_RANGE">{t("实数区间")}</option><option value="MIXED">{t("混合")}</option></select></label></>}
    {scene.kind==='perlin'&&<label className="field"><span>{t("探索强度")}</span><select aria-label={t("探索强度")} value={perlinIntensity} onChange={e=>setPerlinIntensity(e.target.value as PerlinRandomIntensity)}><option value="conservative">{t("保守")}</option><option value="balanced">{t("均衡")}</option><option value="aggressive">{t("大胆")}</option></select></label>}
    <label className="field"><span>{t("探索种子")}</span><input aria-label={t("探索种子")} type="number" min={0} max={4294967295} step={1} value={seed} disabled={searching} onChange={e=>setSeed(Math.max(0,Number(e.target.value))>>>0)}/></label>
    {scene.kind==='attractor'&&<label className="field"><span>{t("候选数量")}</span><input aria-label={t("稳定搜索候选数量")} type="number" min={1} max={120} step={1} value={attempts} disabled={searching} onChange={e=>setAttempts(Math.max(1,Math.min(120,Math.round(Number(e.target.value)))))}/></label>}
    <div className="explore-actions"><button className="apply-button" disabled={searching||customSymmetry} onClick={()=>explore()}><Sparkles size={14}/>{scene.kind==='attractor'?'Random Stable':scene.kind==='surface'?'Explore':scene.kind==='perlin'?'Random':scene.kind==='samila'||scene.kind==='roots'||scene.kind==='domain'&&domainMode==='formula'?t("随机方程"):t("生成组合")}</button>{scene.kind==='perlin'&&<button onClick={()=>explore('deep')}>Deep Random</button>}{scene.kind==='samila'&&<button onClick={()=>{try{baseline.current??=structuredClone(scene);onChange({...scene,parameters:randomizeSamilaParameters(scene.parameters,seed,parameterSamplingRanges(scene)),settings:{...scene.settings,funcSeed:seed}});setSeed((seed+1)>>>0);setMessage('参数已更新，方程保持当前形式');}catch(error){setMessage(String(error));}}}>{t("随机参数")}</button>}{searching&&<button onClick={()=>worker.current?.cancel()}>{t("取消搜索")}</button>}<button aria-label={t("返回探索基线")} disabled={!changed||searching} onClick={()=>{if(baseline.current){onChange(restoreExplorationBaseline(scene,baseline.current));setMessage('已恢复探索开始前的设置');}}}><RotateCcw size={13}/>{t("返回基线")}</button></div>
    {searching&&<p className="muted" role="status">{t("正在检验候选 {attempt} / {total} · 通过 {accepted}",{attempt:scene.kind==='attractor'?progress?.attempt??0:complexProgress?.attempt??0,total:scene.kind==='attractor'?attempts:complexProgress?.total??rootOptions.candidateCount??12,accepted:scene.kind==='attractor'?progress?.accepted??0:complexProgress?.accepted??0})}</p>}
    {customSymmetry&&<p className="muted">{t('自定义 GLSL 不能使用内置模板的轨迹筛选；请先切换为模板公式。')}</p>}
    {message&&<p className="muted" role="status">{t(message)}</p>}
    {scene.kind==='attractor'&&<small className="muted">{t("根据有限轨迹的发散、覆盖和退化程度筛选；搜索保持当前缩放与位置。")}</small>}
  </div></details>;
}
