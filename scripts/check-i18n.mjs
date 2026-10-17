import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chinese=/[\u3400-\u9fff]/;
const placeholders=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
export function inspectSource(text,file,catalog){
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),rows=[];
 const translated=node=>{for(let n=node.parent;n;n=n.parent){if(ts.isCallExpression(n)&&(['t','translate'].includes(n.expression.getText(ast))))return true;if(ts.isFunctionLike(n)||ts.isStatement(n))break;}return false;};
 const uiLiteral=node=>{for(let n=node.parent;n;n=n.parent){if(ts.isCallExpression(n)||ts.isFunctionLike(n))return false;if(ts.isJsxAttribute(n))return !n.name.getText(ast).startsWith('on');if(ts.isJsxExpression(n))return true;if(ts.isStatement(n))return false;}return false;};
 const add=(node,source,category)=>{if(!chinese.test(source))return;const location=ast.getLineAndCharacterOfPosition(node.getStart(ast));rows.push({file,line:location.line+1,source,category,translated:Object.hasOwn(catalog,source)});};
 const walk=node=>{
  if(ts.isJsxText(node)){const value=node.text.replace(/\s+/g,' ').trim();add(node,value,'raw_jsx_text');}
  else if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))add(node,node.text,translated(node)?'explicit_translation':uiLiteral(node)?'raw_jsx_literal':'source_literal');
  else if(ts.isTemplateExpression(node)){const value=node.head.text+node.templateSpans.map((span,i)=>`{${i}}${span.literal.text}`).join('');add(node,value,translated(node)?'explicit_translation':uiLiteral(node)?'raw_jsx_literal':'source_template');}
  ts.forEachChild(node,walk);
 };walk(ast);return rows;
}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(path.join(dir,f.name)):/\.tsx?$/.test(f.name)?[path.join(dir,f.name)]:[]);}
export function audit(){
 const catalogs=['metadata','components','application'].map(name=>({name,data:JSON.parse(fs.readFileSync(path.join(root,'src/locales',name+'.en.json'),'utf8'))}));
 const catalog=Object.assign({},...catalogs.map(c=>c.data)),issues=[];
 for(const{ name,data}of catalogs)for(const[source,value]of Object.entries(data))if(typeof value!=='string'||!value.trim()||chinese.test(value)||JSON.stringify(placeholders(source))!==JSON.stringify(placeholders(value)))issues.push({catalog:name,source,translation:value,reason:'Empty/non-English translation or placeholder mismatch'});
 const rows=files(path.join(root,'src')).filter(f=>!f.includes('/locales/')).flatMap(file=>inspectSource(fs.readFileSync(file,'utf8'),path.relative(root,file),catalog));
 const intentionalAutonyms=rows.filter(r=>r.file==='src/App.tsx'&&r.category==='raw_jsx_text'&&r.source==='中文');
 const ui=rows.filter(r=>r.file.endsWith('.tsx')),required=ui.filter(r=>!intentionalAutonyms.includes(r)&&(r.category.startsWith('raw_jsx')||r.category==='explicit_translation'&&!r.translated));
 const remaining=rows.filter(r=>!r.translated&&r.category!=='explicit_translation'&&!r.category.startsWith('raw_jsx'));
 return{schemaVersion:1,generatedAt:new Date().toISOString(),scope:'Explicit React UI translation and built-in metadata; user names, equations and IDs are not translated. Engine diagnostic inventory is not a claim of full English coverage.',status:issues.length||required.length?'failed':'static_ui_pass',catalog:{entries:Object.keys(catalog).length,files:catalogs.map(c=>({name:c.name,entries:Object.keys(c.data).length}))},counts:{sourceOccurrences:rows.length,explicitUiTranslations:ui.filter(r=>r.category==='explicit_translation').length,requiredUiGaps:required.length,untranslatedSourceOccurrences:remaining.length},intentionalAutonyms:intentionalAutonyms.map(r=>({...r,reason:'Language selector uses its own language name'})),catalogIssues:issues,requiredUiGaps:required,untranslatedSourceMessages:remaining,inventory:rows,limitations:['This syntax audit cannot prove dynamic expressions call the translator. Metadata and rendered components are separately tested in tests/i18n.test.ts.','Source diagnostics include errors, warnings, importer provenance and comments represented as strings. Unknown messages deliberately retain the original source.','No original application localization or string-by-string runtime parity is claimed.']};
}
function selfTest(){
 const c={'名称':'Name'},s=`function Demo(){return <><span>名称</span><input title="名称"/><p>{t('名称')}</p><p>{t('遗漏')}</p><button onClick={()=>setError('保留原错误')}>OK</button></>}`;
 const rows=inspectSource(s,'fixture.tsx',c);if(rows.filter(r=>r.category.startsWith('raw_jsx')).length!==2||!rows.some(r=>r.category==='explicit_translation'&&!r.translated)||rows.find(r=>r.source==='保留原错误')?.category!=='source_literal')throw new Error('AST audit failed its raw JSX, missing key or canonical state fixture');console.log('i18n audit self-test passed');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.includes('--self-test'))selfTest();
 const report=audit();
 const {createServer}=await import('vite');const server=await createServer({root,configFile:false,cacheDir:'.cache/i18n-audit-vite',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 try{const {builtInTranslationSources}=await server.ssrLoadModule('/src/i18nMetadata.ts');const metadata=builtInTranslationSources();const keys=new Set(['metadata','components','application'].flatMap(name=>Object.keys(JSON.parse(fs.readFileSync(path.join(root,'src/locales',name+'.en.json'),'utf8')))));report.metadata={occurrences:metadata.length,uniqueStrings:new Set(metadata.map(r=>r.source)).size,missing:metadata.filter(r=>!keys.has(r.source))};if(report.metadata.missing.length)report.status='failed';}finally{await server.close();}
 const uiReportPath=path.resolve(root,'../.cache/mathart-investigation/i18n-ui-report.json');
 if(fs.existsSync(uiReportPath)){const ui=JSON.parse(fs.readFileSync(uiReportPath,'utf8'));const changedSources=Object.entries(ui.sourceHashes??{}).filter(([file,hash])=>!fs.existsSync(path.resolve(root,'..',file))||createHash('sha256').update(fs.readFileSync(path.resolve(root,'..',file))).digest('hex')!==hash).map(([file])=>file);report.browserEvidence={path:path.relative(root,uiReportPath),status:ui.status,completedAt:ui.completedAt,checks:ui.checks,changedSources,scope:'Browser evidence is historical if any source digest differs. No renderer/original-app parity claimed.'};}
 report.testEvidence={path:'tests/i18n.test.tsx',scope:'Run separately: npm test -- --run tests/i18n.test.tsx. This audit does not run or certify the test suite.'};
 fs.mkdirSync(path.join(root,'coverage'),{recursive:true});fs.writeFileSync(path.join(root,'coverage/i18n-status.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,catalog:report.catalog,counts:report.counts,metadata:report.metadata,catalogIssues:report.catalogIssues,requiredUiGaps:report.requiredUiGaps},null,2));if(report.status==='failed')process.exitCode=1;
}
