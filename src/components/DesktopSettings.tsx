import {useI18n} from '../i18n';
import {useEffect,useState} from 'react';
interface DesktopPreferences {outputDirectory:string;ffmpegPath?:string;activeFFmpeg:string;ffmpegWarning?:string;ffmpegOverride:boolean;}
interface DesktopBridge {preferences():Promise<DesktopPreferences>;chooseOutputDirectory():Promise<DesktopPreferences|null>;chooseFFmpeg():Promise<DesktopPreferences|null>;onDownloadStatus(callback:(result:{state:string;filename:string})=>void):()=>void;}
declare global {interface Window {mathartDesktop?:DesktopBridge;}}
export function DesktopSettings(){
  const {t}=useI18n();
 const bridge=window.mathartDesktop,[preferences,setPreferences]=useState<DesktopPreferences|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;bridge?.preferences().then(value=>{if(active)setPreferences(value);}).catch(error=>{if(active)setError(String(error));});return()=>{active=false;};},[bridge]);
 async function choose(kind:'output'|'ffmpeg'){if(!bridge)return;setBusy(true);setError('');try{const value=await(kind==='output'?bridge.chooseOutputDirectory():bridge.chooseFFmpeg());if(value)setPreferences(value);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}
 if(!bridge)return <p className="muted">{t("输出目录由浏览器的下载设置决定。桌面版支持选择固定输出目录和 FFmpeg。")}</p>;
 return <div className="desktop-settings"><label className="field"><span>{t("输出目录")}</span><button disabled={busy} onClick={()=>choose('output')}>{t("选择文件夹…")}</button></label><p className="path-value">{preferences?.outputDirectory??t("读取设置…")}</p><label className="field"><span>FFmpeg</span><button disabled={busy||preferences?.ffmpegOverride} onClick={()=>choose('ffmpeg')}>{t("选择可执行文件…")}</button></label><p className="path-value">{preferences?.ffmpegPath??preferences?.activeFFmpeg}</p><small className="muted">{preferences?.ffmpegOverride?t("当前 FFmpeg 由启动环境指定。"):t("输出目录立即生效；FFmpeg 更改在重新打开应用后生效。")}</small>{(error||preferences?.ffmpegWarning)&&<p className="export-error" role="alert">{t(error||preferences?.ffmpegWarning||'')}</p>}</div>;
}
