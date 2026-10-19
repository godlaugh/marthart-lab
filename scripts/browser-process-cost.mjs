import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

function cpuSeconds(text){
 const [daysPart,timePart]=text.includes('-')?text.split('-'):['0',text],parts=timePart.split(':').map(Number);
 if(parts.some(n=>!Number.isFinite(n))||!Number.isFinite(Number(daysPart)))throw Error('Unrecognized ps CPU time '+text);
 return Number(daysPart)*86400+parts.reverse().reduce((sum,n,i)=>sum+n*60**i,0);
}
async function familySnapshot(rootPid){
 const {stdout}=await run('ps',['-axo','pid=,ppid=,time=,rss=,lstart='],{maxBuffer:8*1024*1024});
 const rows=stdout.trim().split('\n').map(line=>{
  const match=/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/.exec(line);if(!match)throw Error('Unrecognized ps row');
  return{pid:Number(match[1]),ppid:Number(match[2]),cpuSeconds:cpuSeconds(match[3]),rssKiB:Number(match[4]),identity:match[1]+':'+match[5]};
 });
 const included=new Set([rootPid]);let changed=true;while(changed){changed=false;for(const row of rows)if(included.has(row.ppid)&&!included.has(row.pid)){included.add(row.pid);changed=true;}}
 if(!rows.some(row=>row.pid===rootPid))throw Error('Owned browser root process disappeared');
 return rows.filter(row=>included.has(row.pid));
}
export async function measureFamily(rootPid,task){
 const seen=new Map(),failures=[];let samples=0,peakRssKiB=0,maxProcesses=0,stopped=false,timer;
 const sample=async baseline=>{
  try{
   const rows=await familySnapshot(rootPid);samples++;peakRssKiB=Math.max(peakRssKiB,rows.reduce((n,r)=>n+r.rssKiB,0));maxProcesses=Math.max(maxProcesses,rows.length);
   for(const row of rows){const old=seen.get(row.identity);if(old)old.maximum=Math.max(old.maximum,row.cpuSeconds);else seen.set(row.identity,{pid:row.pid,baseline:baseline?row.cpuSeconds:0,maximum:row.cpuSeconds});}
  }catch(error){failures.push(String(error));}
 };
 await sample(true);
 const tick=async()=>{await sample(false);if(!stopped)timer=setTimeout(()=>{pending=tick();},250);};let pending=Promise.resolve();timer=setTimeout(()=>{pending=tick();},250);
 let result;try{result=await task();}finally{stopped=true;clearTimeout(timer);await pending;await sample(false);}
 return{...result,processFamily:{rootPid,samples,observedProcesses:seen.size,maxConcurrentProcesses:maxProcesses,sampledPeakRssKiB:failures.length?null:peakRssKiB,observedCpuMs:failures.length?null:1000*[...seen.values()].reduce((n,p)=>n+Math.max(0,p.maximum-p.baseline),0),samplingErrors:failures}};
}
