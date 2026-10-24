import {afterEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import App from '../src/App';
import {ArtworkLibrary} from '../src/components/ArtworkLibrary';
import {definitions,definition} from '../src/scenes';
import {creationDefinitions,defaultCreationTemplate,isCreationKind,creationCatalogForMode,createCreationScene,isBuiltinCreationScene} from '../src/scenes/releaseCatalog';
import {createScene,loadWorkspace,persistentScene,saveWorkspace,serializeScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {emptyLibrary,moveArtwork,trashArtwork} from '../src/engine/library';

function memoryStorage():Storage {
  const values=new Map<string,string>();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);},removeItem:key=>{values.delete(key);},clear:()=>values.clear(),key:index=>[...values.keys()][index]??null,get length(){return values.size;}};
}
afterEach(()=>vi.unstubAllGlobals());

describe('1.0 discovery and compatible documents',()=>{
  it('keeps the complete registry while exposing one creation family and an explicit visible startup template',()=>{
    expect(definitions).toHaveLength(12);
    expect(creationDefinitions.map(item=>item.kind)).toEqual(['spirograph']);
    expect(creationDefinitions[0]).toBe(definition('spirograph'));
    expect(defaultCreationTemplate.preset.id).toBe('hypotrochoid');
    expect(defaultCreationTemplate.preset).not.toBe(definition('spirograph').presets[0]);
    const scene=createScene(defaultCreationTemplate.definition,defaultCreationTemplate.preset);
    expect(scene.kind).toBe('spirograph');expect(scene.settings.animate).toBe(false);
    const output=defaultCreationTemplate.definition.generate(scene,{time:0,width:96,height:72,quality:'preview'});
    expect(output.stats.generated).toBeGreaterThan(0);
    expect(definition('spirograph').presets).toHaveLength(7);
  });

  it.each(definitions)('preserves $kind authored data through the public file route even when creation is hidden',def=>{
    const scene=createScene(def);
    scene.name=`Saved ${def.kind}`;
    scene.provenance={kind:'MathArt Studio',original:{unmapped:{keep:[1,'source']}},warnings:['retained warning']};
    const before=structuredClone(scene),file=parseProjectFile(serializeScene(scene));
    expect(file.format).toBe('local');expect(file.scene).toEqual(persistentScene(before));
    expect(isCreationKind(file.scene.kind)).toBe(def.kind==='spirograph');
    expect(definition(file.scene.kind)).toBe(def);
    expect(scene).toEqual(before);
  });

  it('retains other scene families in saved works, active drafts, folders and trash across workspace reload',()=>{
    const store=memoryStorage(),scenes=definitions.map(def=>({...createScene(def),id:`saved:${def.kind}`,favorite:def.kind==='domain'}));
    const active=scenes.find(scene=>scene.kind==='surface')!,draft={...structuredClone(active),name:'Unfinished surface draft'};
    let library=emptyLibrary();
    library={...library,folders:[{id:'folder',name:'Existing',parentId:null}],selected:'folder'};
    for(const scene of scenes)library=moveArtwork(library,scene.id,'folder',1);
    library=trashArtwork(library,'saved:roots',2);
    const workspace={scenes,drafts:{[active.id]:draft},active:active.id,theme:'dark' as const,language:'zh' as const,library};
    saveWorkspace(store,workspace);expect(loadWorkspace(store)).toEqual(workspace);
    vi.stubGlobal('localStorage',store);vi.stubGlobal('devicePixelRatio',1);
    const html=renderToStaticMarkup(<App/>);
    expect(html).toContain('Unfinished surface draft');
    expect(html).toContain('此场景的完整创作支持计划于 2.0');
    expect(html).toContain('title="导出项目 JSON"');
    expect(html).toContain('title="保存副本"');
    expect(loadWorkspace(store)).toEqual(workspace);
  });

  it('renders only seven Spirograph templates on first launch and exposes the existing redo action',()=>{
    vi.stubGlobal('localStorage',memoryStorage());vi.stubGlobal('devicePixelRatio',1);
    const html=renderToStaticMarkup(<App/>);
    expect(html).toContain('三叶内旋');
    expect((html.match(/class="preset-card/g)??[])).toHaveLength(7);
    expect((html.match(/preset-art art-spirograph/g)??[])).toHaveLength(7);
    expect(html).not.toContain('preset-art art-surface');
    expect(html).not.toContain('此场景的完整创作支持计划于 2.0');
    expect(html).toContain('title="重做" aria-label="重做" disabled=""');
  });

  it('displays saved non-release artworks through the full registry instead of hiding them',()=>{
    const scenes=definitions.map(def=>({...createScene(def),name:`Existing ${def.kind}`}));
    const html=renderToStaticMarkup(<ArtworkLibrary library={emptyLibrary()} scenes={scenes} drafts={[]} active={scenes[0].id} search="" onChange={()=>{}} onLoad={()=>{}} onCreate={()=>{}} onRename={()=>{}} onDuplicate={()=>{}} onFavorite={()=>{}}/>);
    for(const scene of scenes)expect(html).toContain(`Existing ${scene.kind}`);
    expect((html.match(/class="artwork-open"/g)??[])).toHaveLength(12);
  });
});

describe('2.0 preview discovery',()=>{
  it('exposes every family in preview with canonical Bouncing creation templates',()=>{
    const preview=creationCatalogForMode('preview-v2');expect(preview.map(d=>d.kind)).toEqual(definitions.map(d=>d.kind));expect(Object.isFrozen(preview)).toBe(true);
    for(const def of definitions.filter(d=>d.kind!=='bouncing'))expect(preview.find(item=>item.kind===def.kind)).toBe(def);
    expect(preview.find(d=>d.kind==='bouncing')!.presets).toHaveLength(7);
    for(const mode of ['development','production','test','unknown'])expect(creationCatalogForMode(mode).map(item=>item.kind)).toEqual(['spirograph']);
  });
});


describe('Bouncing creation identity and persistence',()=>{
  it('starts each new work from the spiral recipe with an independent identity',()=>{
    const first=createCreationScene('bouncing'),second=createCreationScene('bouncing');
    expect(first.id).not.toBe(second.id);expect(isBuiltinCreationScene(first)).toBe(false);
    expect(first.bouncingSource?.configuration).toMatchObject({particleCount:2_000_000,subSteps:1,initialPositionMode:'SPIRAL',initialSpeed:Math.fround(.2)});
    expect(first.settings).toEqual({});expect(first.equations).toEqual({});expect(first.parameters).toEqual({});expect(first.timeline.tracks).toEqual([]);
    expect(parseProjectFile(serializeScene(first)).scene).toEqual(persistentScene(first));
    first.bouncingSource!.configuration.particleCount=17;
    expect(second.bouncingSource?.configuration.particleCount).toBe(2_000_000);
    expect(createCreationScene('bouncing').bouncingSource?.configuration.particleCount).toBe(2_000_000);
  });
  it('preserves all seven example payloads through workspace and project files, with copy-on-save identity',()=>{
    const presets=creationCatalogForMode('preview-v2').find(d=>d.kind==='bouncing')!.presets;
    const scenes=presets.map(p=>createCreationScene('bouncing',p.id)),store=memoryStorage();
    expect(scenes.map(s=>s.bouncingSource!.configuration.particleCount)).toEqual([2_000_000,5_000_000,1_000_000,1_000_000,2_000_000,500_000,2_000_000]);
    for(const scene of scenes){expect(isBuiltinCreationScene(scene)).toBe(true);expect(parseProjectFile(serializeScene(scene)).scene).toEqual(persistentScene(scene));}
    saveWorkspace(store,{scenes,active:scenes[0].id,theme:'dark',language:'zh'});
    expect(loadWorkspace(store)?.scenes).toEqual(scenes);
    expect(()=>createCreationScene('bouncing','missing')).toThrow('Unknown creation template');
  });
  it('keeps legacy documents and their built-in identities readable',()=>{
    const def=definition('bouncing'),legacy=createScene(def,def.presets[0]);
    expect(legacy.bouncingSource).toBeUndefined();expect(isBuiltinCreationScene(legacy)).toBe(true);
    expect(parseProjectFile(serializeScene(legacy)).scene).toEqual(persistentScene(legacy));
  });
});
