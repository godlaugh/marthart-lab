/** Verify the user-facing built preview and its configured local API proxy. */
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const origin=process.argv[2]??'http://127.0.0.1:5179',directory=process.argv[3]??`.cache/v2-preview-exports-${Date.now()}`;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Select an explicit local preview origin');
await mkdir(directory,{recursive:true});const check=(v,m)=>{if(!v)throw Error(m);},report={at:new Date().toISOString(),origin,status:'running',scope:'Built preview served through npm run preview:v2; actual default local export server and configured proxy. Fresh isolated browser workspace.',limits:['One local Surface template; other scene/video semantics are covered separately.','No original pixel parity or desktop package test.']};let browser,page;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
 await page.goto(origin);await page.getByTestId('creation-preview-note').waitFor();report.health=await page.evaluate(async()=>{const r=await fetch('/api/health');if(!r.ok)throw Error('health '+r.status);return r.json();});check(report.health.ffmpeg,'FFmpeg unavailable');
 const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('就绪')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
 await ready();await page.locator('.category-grid').getByRole('button',{name:'参数曲面',exact:true}).click();await page.locator('.preset-card').first().click();await ready();
 await page.getByRole('button',{name:'导出作品',exact:true}).click();await page.getByRole('combobox',{name:'导出分辨率',exact:true}).selectOption('custom');
 for(const [name,value] of [['导出宽度','96'],['导出高度','72']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
 let download=page.waitForEvent('download');await page.getByRole('button',{name:'开始导出',exact:true}).click();let file=await download;await file.saveAs(directory+'/surface.png');
 const png=await readFile(directory+'/surface.png');check(png.readUInt32BE(16)===96&&png.readUInt32BE(20)===72,'PNG dimensions');report.png={width:96,height:72,bytes:png.length};
 await page.getByRole('button',{name:'动画视频',exact:true}).click();for(const [name,value] of [['导出宽度','64'],['导出高度','48'],['导出帧率','4'],['导出时长','.5']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
 download=page.waitForEvent('download');await page.getByRole('button',{name:'开始导出',exact:true}).click();file=await download;const path=directory+'/surface.mp4';await file.saveAs(path);
 const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,duration','-of','json',path],{encoding:'utf8'})).streams[0];check(metadata.width===64&&metadata.height===48&&Number(metadata.nb_read_frames)===2&&metadata.r_frame_rate==='4/1'&&Number(metadata.duration)===.5,'MP4 metadata mismatch');report.video=metadata;check(!errors.length,'page errors');report.pageErrors=errors;await page.screenshot({path:directory+'/export-complete.png'});report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);report.body=await page?.locator('body').innerText().catch(()=>undefined);await page?.screenshot({path:directory+'/failure.png'}).catch(()=>{});}
finally{await browser?.close();await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(report.status!=='passed')process.exitCode=1;}
