import { configureDesktopGraphics } from '../desktop/graphics.mjs';

// Reference builders and the product verifier must select the same explicit
// host profile. Browser is retained as the default for historical reports.
export function samilaValidationGraphics(argv) {
  const desktop = argv.includes('--desktop-graphics');
  const positional = argv.filter(value => value !== '--desktop-graphics');
  if (positional.some(value => value.startsWith('--'))) throw Error('Unknown validation option');
  const switches = new Map();
  if (desktop) configureDesktopGraphics({
    getSwitchValue: name => switches.get(name) ?? '',
    appendSwitch: (name, value) => switches.set(name, value),
  });
  return {
    positional,
    args: [...switches].map(([name, value]) => `--${name}=${value}`),
    policy: { profile: desktop ? 'desktop' : 'browser', platform: process.platform, switches: Object.fromEntries(switches) },
  };
}

export function assertSamilaGraphicsProfile(reference, policy) {
  const recorded = reference.graphicsPolicy;
  if (!recorded && policy.profile === 'browser') return; // Historical browser fixtures.
  if (!recorded || recorded.profile !== policy.profile || recorded.platform !== policy.platform ||
      JSON.stringify(recorded.switches) !== JSON.stringify(policy.switches)) {
    throw Error('Reference graphics profile differs from requested verification profile; rebuild both references with the same option');
  }
}
