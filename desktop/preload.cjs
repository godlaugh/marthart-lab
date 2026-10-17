const {ipcRenderer,contextBridge}=require('electron');
contextBridge.exposeInMainWorld('mathartDesktop',{
 preferences:()=>ipcRenderer.invoke('mathart:preferences'),
 chooseOutputDirectory:()=>ipcRenderer.invoke('mathart:choose-output'),
 chooseFFmpeg:()=>ipcRenderer.invoke('mathart:choose-ffmpeg'),
 onDownloadStatus:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('mathart:download-status',listener);return()=>ipcRenderer.removeListener('mathart:download-status',listener);},
});
const keys=['mathart-lab-v1','mathart-lab-v1-backup','mathart-lab-v1-recovery'];
try{
 const saved=ipcRenderer.sendSync('mathart:workspace-load');
 for(const key of keys){if(typeof saved?.[key]==='string')localStorage.setItem(key,saved[key]);}
}catch(error){console.error('工作区恢复失败',error.message);}
let previous='';
function save(){try{const values={};for(const key of keys){const value=localStorage.getItem(key);if(value!==null)values[key]=value;}const text=JSON.stringify(values);if(text!==previous){previous=text;ipcRenderer.send('mathart:workspace-save',values);}}catch(error){console.error('工作区保存失败',error.message);}}
setInterval(save,1000);window.addEventListener('beforeunload',save);
