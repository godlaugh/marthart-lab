import {app,BrowserWindow,Menu,ipcMain,session,dialog} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createDesktopHost,findFFmpeg} from './host.mjs';
import {createWorkspaceStore,STORAGE_KEYS} from './storage.mjs';
import {createDesktopPreferences} from './preferences.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),name='MathArt Lab';
app.setName(name);
const smokeReport=app.commandLine.getSwitchValue('mathart-smoke-report');
const workspaceDirectory=app.commandLine.getSwitchValue('mathart-user-data');
app.setPath('userData',workspaceDirectory?path.resolve(workspaceDirectory):path.join(app.getPath('appData'),name));
app.commandLine.appendSwitch('disable-background-networking');
let host,store,preferences,activeFFmpeg,ffmpegWarning='',window,closing=false,finished=false,report,exitCode=0;
const downloads=new Set();
function trusted(event){return window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame?.url.startsWith(host.origin+'/');}
async function snapshot(){if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed()){
 const values=await window.webContents.executeJavaScript(`(()=>{const result={};for(const key of ${JSON.stringify(STORAGE_KEYS)}){const v=localStorage.getItem(key);if(v!==null)result[key]=v;}return result;})()`);await store.save(values);
 }await store?.flush();await preferences?.flush();}
async function shutdown(){
 if(closing)return;closing=true;
 try{await snapshot();}catch(error){exitCode=1;console.error('工作区保存失败:',error.message);}
 for(const item of downloads)item.cancel();
 let servicesClosed=false,cleanupError;
 try{await host?.close();servicesClosed=true;}catch(error){exitCode=1;cleanupError=error.message;console.error('服务清理失败:',error.message);}
 if(report&&smokeReport){report.shutdown={ownedProcessCount:host?.api.ownedProcessCount??0,servicesClosed,cleanupError};report.exitCode=exitCode;await writeFile(smokeReport,JSON.stringify(report,null,2)+'\n').catch(error=>{console.error(error);exitCode=1;});}
 finished=true;window?.destroy();app.exit(exitCode);
}
app.on('before-quit',event=>{if(!finished){event.preventDefault();void shutdown();}});
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
app.on('window-all-closed',()=>{if(!closing)app.quit();});
app.on('activate',()=>{if(window&&!window.isDestroyed())window.show();});
app.on('second-instance',()=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}});
async function start(){try{
 await app.whenReady();const userData=app.getPath('userData');
 store=await createWorkspaceStore(userData);
 preferences=await createDesktopPreferences(userData);
 const configuredFFmpeg=process.env.MATHART_FFMPEG??preferences.read().ffmpegPath;
 try{activeFFmpeg=await findFFmpeg(configuredFFmpeg);}catch(error){ffmpegWarning=`所选 FFmpeg 不可用：${error.message}`;console.error(ffmpegWarning);activeFFmpeg=configuredFFmpeg;}
 host=await createDesktopHost({dist:path.join(directory,'../dist'),exportRoot:path.join(userData,'exports'),ffmpegPath:activeFFmpeg});
 const browserSession=session.fromPartition('persist:mathart-lab');
 browserSession.setPermissionRequestHandler((contents,permission,callback)=>callback(permission==='clipboard-sanitized-write'&&contents?.getURL().startsWith(host.origin+'/')));
 browserSession.setPermissionCheckHandler((contents,permission,origin)=>permission==='clipboard-sanitized-write'&&origin===host.origin);
 browserSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
  let allowed=false;try{const url=new URL(details.url);allowed=url.origin===host.origin||['data:','blob:','devtools:'].includes(url.protocol);}catch{}callback({cancel:!allowed});
 });
 await mkdir(path.join(userData,'downloads'),{recursive:true});
 browserSession.on('will-download',(event,item)=>{
  const url=item.getURL();if(!(url.startsWith(host.origin+'/')||url.startsWith('blob:'+host.origin+'/'))){event.preventDefault();return;}
  const original=path.basename(item.getFilename()).replace(/[\x00-\x1f\\/]/g,'_')||'export';const ext=path.extname(original);const filename=path.basename(original,ext)+'-'+randomUUID().slice(0,8)+ext;
  item.setSavePath(path.join(preferences.read().outputDirectory,filename));downloads.add(item);item.once('done',(_event,state)=>{downloads.delete(item);if(!closing&&!window?.isDestroyed())window.webContents.send('mathart:download-status',{state,filename:item.getSavePath()});});
 });
 ipcMain.on('mathart:workspace-load',event=>{event.returnValue=trusted(event)?store.read():{};});
 ipcMain.on('mathart:workspace-save',(event,value)=>{if(trusted(event))void store.save(value).catch(error=>console.error('工作区保存失败:',error.message));});
 const settings=()=>({...preferences.read(),activeFFmpeg,ffmpegWarning,ffmpegOverride:!!process.env.MATHART_FFMPEG});
 ipcMain.handle('mathart:preferences',event=>{if(!trusted(event))throw new Error('请求来源无效');return settings();});
 let selecting=false;
 ipcMain.handle('mathart:choose-output',async event=>{
  if(!trusted(event)||selecting)return null;selecting=true;
  try{const result=await dialog.showOpenDialog(window,{title:'选择作品输出目录',defaultPath:preferences.read().outputDirectory,properties:['openDirectory','createDirectory']});if(result.canceled)return null;await preferences.save({outputDirectory:result.filePaths[0]});return settings();}finally{selecting=false;}
 });
 ipcMain.handle('mathart:choose-ffmpeg',async event=>{
  if(!trusted(event)||selecting)return null;selecting=true;
  try{const result=await dialog.showOpenDialog(window,{title:'选择 FFmpeg 可执行文件',defaultPath:activeFFmpeg,properties:['openFile']});if(result.canceled)return null;await preferences.save({ffmpegPath:result.filePaths[0]});return settings();}finally{selecting=false;}
 });
 window=new BrowserWindow({title:name,width:1440,height:960,minWidth:1000,minHeight:680,show:!smokeReport,backgroundColor:'#111317',webPreferences:{preload:path.join(directory,'preload.cjs'),session:browserSession,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(host.origin+'/'))event.preventDefault();});
 window.webContents.on('will-redirect',(event,url)=>{if(!url.startsWith(host.origin+'/'))event.preventDefault();});
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
 window.on('close',event=>{if(!finished){event.preventDefault();void shutdown();}});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:name,submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'togglefullscreen'}]}]));
 await window.loadURL(host.origin+'/');
 console.log(`MathArt desktop ready: ${host.origin}`);
 if(smokeReport){
  const {runSmoke}=await import('./smoke.mjs');report=await runSmoke({window,host,userData,phase:app.commandLine.getSwitchValue('mathart-smoke-phase')||'initial'});
  report.version={electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node};await shutdown();
 }
}catch(error){exitCode=1;console.error(error);if(smokeReport){report={status:'failed',error:error.stack,origin:host?.origin,port:host?.port,apiPort:host?.apiPort};}else dialog.showErrorBox(name+' 启动失败',error.message);await shutdown();}}
if(app.requestSingleInstanceLock())void start();else{finished=true;app.exit(0);}
