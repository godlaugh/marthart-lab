// ANGLE's Metal program-binary reload can change arithmetic flags. On the
// shipped Electron 44.7.2 / Chromium 152 runtime this changes identical Newton
// inputs across WebGL contexts (also reproduced on Chrome 155). Disable that
// cache, retaining live GL programs and ANGLE's compiled Metal library cache.
// See scripts/verify-fractal-source-color.mjs for the cross-context gate.
export function configureDesktopGraphics(commandLine,platform=process.platform){
 if(platform!=='darwin')return;
 const feature='disableProgramCaching',split=value=>value.split(',').map(s=>s.trim()).filter(Boolean);
 // Explicit caller overrides remain authoritative.
 if(split(commandLine.getSwitchValue('disable-angle-features')).includes(feature))return;
 const enabled=split(commandLine.getSwitchValue('enable-angle-features'));
 if(!enabled.includes(feature))commandLine.appendSwitch('enable-angle-features',[...enabled,feature].join(','));
}
