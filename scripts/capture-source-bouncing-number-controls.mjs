/** Capture bounded pure NumberDragger numerical helpers from the original JAR.
 * Requires an existing JDK, original app dependencies and built REA supervisor.
 * Never launches the original application, creates a session, or changes it.
 */
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {resolve, join, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runOwnedCommand} from '../../dist/process/OwnedCommand.js';
import {spawnOwnedProviderProcess} from '../../dist/process/ProviderProcess.js';
import {observeOwnedProcessGroups} from '../../dist/process/ProcessOwnershipObservation.js';

const JAR_SHA='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018';
const CLASS_SHA='2232b74b091cb54b5960331e1d5338d35fb15dea6b6bdc9d2b78ae3857571b79';
const script=fileURLToPath(import.meta.url);
const shaText=value=>createHash('sha256').update(value).digest('hex');
async function sha(path){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');}
const bits=value=>{const b=Buffer.alloc(8);b.writeDoubleBE(value);return b.toString('hex');};
const numeric=value=>({text:Object.is(value,-0)?'-0':String(value),bits:bits(value)});
const cases=[];
function format(id,value,precision,isInteger=false){cases.push({id,kind:'format',input:{isInteger,precision,value:numeric(value)}});}
function parse(id,text,low,high,isInteger=false){cases.push({id,kind:'parse',input:{isInteger,low:numeric(low),high:numeric(high),text}});}
function step(id,value,explicitStep,precision,isInteger=false){cases.push({id:'step-'+id,kind:'step',input:{isInteger,precision,minimumPrecisionStep:numeric(isInteger?1:10**-precision),value:numeric(value),explicitStep:explicitStep===null?null:numeric(explicitStep)}});}
const F=Math.fround, floatMax=F(3.4028234663852886e38);
format('zero',0,3);format('negative-zero',-0,3);
format('time-step-f32',F(.012),4);format('time-step-double',.012,4);
format('radius-f32',F(.006),3);format('radius-double',.006,3);
format('direction-original-converted',134.39297485351562,1);
for(const precision of [1,2,3]){
 format(`tie-positive-p${precision}`,.0625,precision);
 format(`tie-negative-p${precision}`,-.0625,precision);
}
for(const value of [.06249999999999999,.06250000000000001,.0004999999999999999,.0005,.0005000000000000001,1.005,2.675])format(`round-${value}`,value,3);
for(const value of [1.005,2.675,-1.005,-2.675]){format(`round-p2-double-${value}`,value,2);format(`round-p2-f32-${value}`,F(value),2);}
format('small-negative-zero',-.00001,3);format('large-finite-f32',floatMax,3);format('large-finite-double',1e25,3);
format('integer-trunc-positive',3.9,0,true);format('integer-trunc-negative',-3.9,0,true);
for(const text of ['3.9','-3.9','3+0.9','-3-0.9','0','1','16','17','2147483648','bad',''])parse(`integer-${text||'empty'}`,text,-2147483648,2147483647,true);
for(const text of ['0','1','16','17','3.9','-3.9'])parse(`substeps-${text}`,text,1,16,true);
for(const text of ['0','.0001','.012','.25','.3','1/100','garbage','','   ','  .012  '])parse(`time-step-${text||'empty'}`,text,F(.0001),F(.25));
for(const text of ['-1','0','.2','100','101','1/20'])parse(`speed-${text}`,text,0,floatMax);
for(const text of ['-90','0','360','720','PI/4'])parse(`direction-${text}`,text,-floatMax,floatMax);
for(const text of ['-90','0','360','450'])parse(`spread-${text}`,text,0,360);
for(const text of ['.0625','1.005','2.675','1/3','1e-20','bad'])parse(`unbounded-${text}`,text,-floatMax,floatMax);
for(const value of [1,14,15,16])step(`substeps-${value}`,value,null,0,true);
step('particles',200000,1000,0,true);step('time-step',F(.012),F(.001),4);
step('speed',F(.2),F(.05),3);step('direction',134.39297485351562,5,1);
step('spread',0,5,1);step('lissajous-delta',90,15,1);
assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);

// Java performs no JSON/library parsing: exact inputs use a small TSV protocol.
// The only target methods invoked are the three reviewed static helpers.
const javaSource=String.raw`import java.lang.reflect.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
public final class NumberControlsProbe {
 static String quote(String s){StringBuilder b=new StringBuilder("\"");for(char c:s.toCharArray()){switch(c){case '\\':b.append("\\\\");break;case '"':b.append("\\\"");break;case '\n':b.append("\\n");break;case '\r':b.append("\\r");break;case '\t':b.append("\\t");break;default:if(c<32)b.append(String.format(Locale.ROOT,"\\u%04x",(int)c));else b.append(c);}}return b.append('"').toString();}
 static String hex(byte[] b){return HexFormat.of().formatHex(b);}
 static double value(String b){return Double.longBitsToDouble(Long.parseUnsignedLong(b,16));}
 static String number(Double v){if(v==null)return "{\"isNull\":true}";return "{\"isNull\":false,\"double\":{\"text\":"+quote(Double.toString(v))+",\"bits\":"+quote(String.format(Locale.ROOT,"%016x",Double.doubleToRawLongBits(v)))+"},\"float32\":{\"text\":"+quote(Float.toString(v.floatValue()))+",\"bits\":"+quote(String.format(Locale.ROOT,"%08x",Float.floatToRawIntBits(v.floatValue())))+"}}";}
 static Method method(Class<?> c,String suffix,Class<?>...parameters)throws Exception {Method m=c.getDeclaredMethod("NumericStepperInputCore_oI3XNZo$"+suffix,parameters);m.setAccessible(true);return m;}
 public static void main(String[] args)throws Exception {
  if(args.length!=2)throw new IllegalArgumentException("input and new output required");
  Class<?> c=Class.forName("mathart.ui.components.NumberDraggerKt",false,NumberControlsProbe.class.getClassLoader());
  String classSha;try(var in=c.getResourceAsStream("NumberDraggerKt.class")){classSha=hex(MessageDigest.getInstance("SHA-256").digest(in.readAllBytes()));}
  Method format=method(c,"formatNumber",boolean.class,int.class,double.class);
  Method parse=method(c,"parseNumber",boolean.class,double.class,double.class,String.class);
  Method step=method(c,"resolvedStep",Double.class,boolean.class,double.class,double.class);
  List<String> rows=new ArrayList<>();
  for(String line:Files.readAllLines(Path.of(args[0]),StandardCharsets.UTF_8)){
   String[] p=line.split("\t",-1);String kind=p[0],id=new String(Base64.getDecoder().decode(p[1]),StandardCharsets.UTF_8),result;boolean integer=Boolean.parseBoolean(p[2]);
   if(kind.equals("format"))result="{\"text\":"+quote((String)format.invoke(null,integer,Integer.parseInt(p[3]),value(p[4])))+"}";
   else if(kind.equals("parse"))result=number((Double)parse.invoke(null,integer,value(p[3]),value(p[4]),new String(Base64.getDecoder().decode(p[5]),StandardCharsets.UTF_8)));
   else if(kind.equals("step"))result=number((Double)step.invoke(null,p[3].equals("null")?null:Double.valueOf(value(p[3])),integer,value(p[4]),value(p[5])));
   else throw new IllegalArgumentException(kind);
   rows.add("{\"id\":"+quote(id)+",\"kind\":"+quote(kind)+",\"output\":"+result+"}");
  }
  int windows=java.awt.Window.getWindows().length;if(windows!=0)throw new IllegalStateException("Unexpected window");
  String report="{\"classSha256\":"+quote(classSha)+",\"javaHome\":"+quote(System.getProperty("java.home"))+",\"javaVersion\":"+quote(System.getProperty("java.version"))+",\"javaVendor\":"+quote(System.getProperty("java.vendor"))+",\"headless\":"+java.awt.GraphicsEnvironment.isHeadless()+",\"windowCount\":"+windows+",\"cases\":["+String.join(",",rows)+"]}";
  Files.writeString(Path.of(args[1]),report+"\n",StandardOpenOption.CREATE_NEW);
  System.out.println("numberControlCases="+rows.size());
 }
}
`;

const argv=process.argv.slice(2),outArg=argv.shift(),args={};
while(argv.length){const key=argv.shift(),value=argv.shift();assert.ok(['--app-contents','--java-home'].includes(key)&&value&&!args[key], 'Expected NEW_OUTPUT --app-contents PATH --java-home PATH');args[key]=value;}
assert.ok(outArg&&args['--app-contents']&&args['--java-home'],'Expected NEW_OUTPUT --app-contents PATH --java-home PATH');
const out=resolve(outArg),app=await realpath(join(args['--app-contents'],'app')),jdk=await realpath(args['--java-home']);
const jar=join(app,'MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar');
assert.equal(await sha(jar),JAR_SHA,'Original JAR identity changed');
const dependencies=(await readdir(app)).filter(p=>p.endsWith('.jar')).sort().map(p=>join(app,p));
const identityPaths=[script,...dependencies,join(jdk,'bin/java'),join(jdk,'bin/javac'),join(jdk,'release'),join(jdk,'lib/server/libjvm.dylib'),...['OwnedCommand','ProviderProcess','ProcessOwnership','ProcessOwnershipObservation'].map(name=>fileURLToPath(new URL(`../../dist/process/${name}.js`,import.meta.url)))];
const identities=async()=>Object.fromEntries(await Promise.all(identityPaths.map(async p=>[p,await sha(p)])));
const before=await identities();
await mkdir(out,{mode:0o700}); // Evidence directories are always new, including failed runs.
await mkdir(join(out,'tmp'));await mkdir(join(out,'home'));
const write=(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
await writeFile(join(out,'CaptureScript.mjs'),await readFile(script),{flag:'wx'});
await write('inputs.json',{schemaVersion:1,cases});
await writeFile(join(out,'NumberControlsProbe.java'),javaSource,{flag:'wx'});
const b64=s=>Buffer.from(s).toString('base64');
const lines=cases.map(({id,kind,input:i})=>[kind,b64(id),String(i.isInteger),...(kind==='format'?[i.precision,i.value.bits]:kind==='parse'?[i.low.bits,i.high.bits,b64(i.text)]:[i.explicitStep?.bits??'null',i.minimumPrecisionStep.bits,i.value.bits])].join('\t'));
await writeFile(join(out,'inputs.tsv'),lines.join('\n')+'\n',{flag:'wx'});
const report={schemaVersion:1,status:'running',at:new Date().toISOString(),scope:'Finite direct calls to three original NumberDragger static helpers; no application, project, session, renderer or original GUI lifecycle.',out,sourceBefore:before,commands:[]};
const started=performance.now(),controller=new AbortController();
const interrupt=()=>controller.abort(new Error('Capture interrupted'));
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
async function run(label,command,arguments_){
 const item={label,command,arguments:arguments_,runId:randomUUID()};report.commands.push(item);const start=performance.now();
 try{
  item.snapshot=await runOwnedCommand({command,arguments:arguments_,runId:item.runId,cwd:out,hostEnvironment:{},env:{PATH:join(jdk,'bin')+':/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:join(out,'tmp')},signal:controller.signal},{timeoutMs:30000,diagnosticBytes:262144},{launcher:async options=>{const launched=await spawnOwnedProviderProcess(options);item.ownership=launched.ownership;return launched;}});
  item.reaped=true;
  const observations=await observeOwnedProcessGroups(item.runId,[item.ownership.processGroupId]);
  item.groupAfter=observations.get(item.ownership.processGroupId);assert.equal(item.groupAfter?.state,'empty','Owned process group did not settle');
 }catch(error){item.error=String(error.stack??error);item.snapshot=error.snapshot??item.snapshot;item.cleanupFailure=error.cleanupFailure??null;throw error;}
 finally{item.elapsedMs=performance.now()-start;await write(label+'.json',item);}
}
try{
 await run('compile',join(jdk,'bin/javac'),['-proc:none','-d',out,join(out,'NumberControlsProbe.java')]);
 await run('run',join(jdk,'bin/java'),['-Djava.awt.headless=true','-Duser.home='+join(out,'home'),'-Djava.io.tmpdir='+join(out,'tmp'),'-cp',[out,...dependencies].join(delimiter),'NumberControlsProbe',join(out,'inputs.tsv'),join(out,'numerics.json')]);
 const native=JSON.parse(await readFile(join(out,'numerics.json'),'utf8'));
 assert.equal(native.classSha256,CLASS_SHA);assert.equal(native.windowCount,0);assert.equal(native.headless,true);assert.equal(native.cases.length,cases.length);
 for(let index=0;index<cases.length;index++){assert.equal(native.cases[index].id,cases[index].id);assert.equal(native.cases[index].kind,cases[index].kind);}
 const fixture={schemaVersion:1,scope:report.scope,runtime:Object.fromEntries(Object.entries(native).filter(([key])=>key!=='cases')),cases:cases.map((row,index)=>({...row,output:native.cases[index].output}))};
 await write('native.json',fixture);
 report.totals=Object.fromEntries(['format','parse','step'].map(kind=>[kind,cases.filter(c=>c.kind===kind).length]));
 report.classSha256=native.classSha256;report.probeSourceSha256=shaText(javaSource);report.probeClassSha256=await sha(join(out,'NumberControlsProbe.class'));report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 report.sourceAfter=await identities();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable){report.status='failed';process.exitCode=1;}
 report.elapsedMs=performance.now()-started;
 report.evidence=Object.fromEntries(await Promise.all(['CaptureScript.mjs','inputs.json','inputs.tsv','NumberControlsProbe.java','compile.json',...(report.commands.some(c=>c.label==='run')?['run.json']:[]),...(report.status==='passed'?['numerics.json','native.json']:[])].map(async name=>[join(out,name),await sha(join(out,name))])));
 await write('source.json',report);process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
 console.log(JSON.stringify({status:report.status,totals:report.totals,elapsedMs:report.elapsedMs,error:report.error?.split('\n')[0].slice(0,400),report:join(out,'source.json')}));
}
