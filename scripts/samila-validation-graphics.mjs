import { configureDesktopGraphics } from '../desktop/graphics.mjs';
import { chromium, _electron } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Reference builders and the product verifier must select the same explicit
// host profile. Browser is retained as the default for historical reports.
export function samilaValidationGraphics(argv) {
  const desktop = argv.includes('--desktop-graphics');
  const electron = argv.includes('--electron-runtime');
  const positional = argv.filter(value => value !== '--desktop-graphics' && value !== '--electron-runtime');
  if (positional.some(value => value.startsWith('--'))) throw Error('Unknown validation option');
  const switches = new Map();
  if (desktop) configureDesktopGraphics({
    getSwitchValue: name => switches.get(name) ?? '',
    appendSwitch: (name, value) => switches.set(name, value),
  });
  return {
    positional,
    args: [...switches].map(([name, value]) => `--${name}=${value}`),
    policy: { profile: desktop ? 'desktop' : 'browser', runtime: electron ? 'electron' : 'chrome', platform: process.platform, switches: Object.fromEntries(switches) },
  };
}

export function assertSamilaGraphicsProfile(reference, policy) {
  const recorded = reference.graphicsPolicy;
  if (!recorded && policy.profile === 'browser' && policy.runtime === 'chrome') return; // Historical Chrome fixtures.
  if (!recorded || recorded.profile !== policy.profile || recorded.platform !== policy.platform ||
      (recorded.runtime ?? 'chrome') !== policy.runtime ||
      JSON.stringify(recorded.switches) !== JSON.stringify(policy.switches)) {
    throw Error('Reference graphics profile differs from requested verification profile; rebuild both references with the same option');
  }
}

// One explicit owner of the disposable browser/application and its initial page.
// The renderer imports production engine modules, but never starts the product UI.
export async function launchSamilaValidationHost(graphics) {
  if (graphics.policy.runtime === 'chrome') {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: graphics.args });
    try {
      const page = await browser.newPage();
      return { page, version: browser.version(), runtime: { kind: 'chrome', version: browser.version() }, close: () => browser.close() };
    } catch (error) { await browser.close(); throw error; }
  }
  await mkdir('.cache', { recursive: true });
  const directory = await mkdtemp(resolve('.cache/samila-electron-host-'));
  const entry = directory + '/entry.mjs';
  await writeFile(entry, `import {app,BrowserWindow} from 'electron';
app.setPath('userData',${JSON.stringify(directory + '/profile')});
if(process.platform==='darwin')app.setActivationPolicy('accessory');
const watchdog=setTimeout(()=>app.exit(2),120000);watchdog.unref();
let ownedWindow;
async function run(){await app.whenReady();
ownedWindow=new BrowserWindow({show:false,skipTaskbar:true,width:64,height:64,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
ownedWindow.on('closed',()=>{ownedWindow=null;});
await ownedWindow.loadURL('about:blank');
app.on('window-all-closed',()=>app.quit());
}void run().catch(error=>{console.error(error);app.exit(1);});
`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await _electron.launch({ args: [entry, ...graphics.args], env, timeout: 30000 });
  try {
    const page = await application.firstWindow({ timeout: 30000 });
    const runtime = await application.evaluate(({ app, BrowserWindow }) => ({
      kind: 'electron', electron: process.versions.electron, chrome: process.versions.chrome,
      features: app.commandLine.getSwitchValue('enable-angle-features'),
      visibleWindows: BrowserWindow.getAllWindows().filter(window => window.isVisible()).length,
    }));
    if (runtime.visibleWindows !== 0) throw Error('Diagnostic Electron window became visible');
    return { page, version: runtime.chrome, runtime: { ...runtime, directory }, close: () => application.close() };
  } catch (error) { await application.close(); throw error; }
}
