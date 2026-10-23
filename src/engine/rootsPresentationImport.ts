import {defaultRootsPendingConfiguration, defaultRootsPresentationConfiguration, prepareRootsPresentationConfiguration, type RootsPresentationConfiguration, type RootsPresentationConfigurationError} from './rootsPresentationConfig';
import {parseRootsSourceScalar} from './rootsSourceScalar';
import {javaTrim} from './sourceJavaText';
import {prepareRootsSourceJsonInt} from './rootsSourceOrder';
import {ROOTS_PRESENTATION_INTEGER_PATHS, ROOTS_PRESENTATION_SCALAR_PATHS} from './rootsSourceFields';

type ScalarPath = typeof ROOTS_PRESENTATION_SCALAR_PATHS[number];
type SourceRead = (path: readonly string[], kind: 'scalar' | 'mode' | 'integer') => unknown;
type IntegerError = Extract<ReturnType<typeof prepareRootsSourceJsonInt>, {ok: false}>['error'];
export class RootsPresentationIntegerImportError extends Error {
 readonly kind: 'input' | 'capacity';
 constructor(readonly path: readonly string[], readonly sourceError: IntegerError) {
  super(`Invalid source Roots integer at ${path.join('.')}: ${sourceError.kind}`);
  this.name = 'RootsPresentationIntegerImportError';
  this.kind = sourceError.kind === 'capacity' ? 'capacity' : 'input';
 }
}
type ImportResult = {ok: true; value: {configuration: RootsPresentationConfiguration; diagnostics: string[]}} |
 {ok: false; error: RootsPresentationConfigurationError | RootsPresentationIntegerImportError};

/** Direct source runtime construction, not ProjectState's unverified UI
 * loading route. Wrapper accumulation and camera center/zoom are not consumed
 * here. The Reader retains their original leaves as unapplied evidence. */
export function prepareRootsPresentationImport(read: SourceRead, options: {
 numberToken?: (path: readonly string[]) => string | undefined;
} = {}): ImportResult {
 const configuration = defaultRootsPresentationConfiguration(), diagnostics: string[] = [];
 const pending = defaultRootsPendingConfiguration(), maxSplatPath = ROOTS_PRESENTATION_INTEGER_PATHS[0];
 const maxSplat = prepareRootsSourceJsonInt(read(maxSplatPath, 'integer'), pending.maxSplatPointsPerFrame, options.numberToken?.(maxSplatPath));
 if (!maxSplat.ok) return {ok: false, error: new RootsPresentationIntegerImportError(maxSplatPath, maxSplat.error)};
 pending.maxSplatPointsPerFrame = Math.max(1, maxSplat.value.value);
 configuration.pending = pending;configuration.previewMode='live-worker-arrival-v1';
 if (maxSplat.value.route === 'fallback' && maxSplat.value.fallbackReason !== 'missing')
  diagnostics.push(`${maxSplatPath.join('.')} 按源整数规则使用默认值 ${maxSplat.value.canonicalText}；原值保留在 source。`);
 const scalar = (path: ScalarPath, fallback: number): number => {
  const parsed = parseRootsSourceScalar(read(path, 'scalar'), fallback);
  diagnostics.push(...parsed.diagnostics.map(message => `${path.join('.')}：${message}`));
  return parsed.value;
 };
 const rawMode = read(['settings', 'render_mode'], 'mode');
 const mode = typeof rawMode === 'string' ? javaTrim(rawMode).toUpperCase() : '';
 configuration.mode = mode === 'GPU_3D' || mode === 'GPU_DENSITY_3D' ? 'point-cloud' : 'density';
 configuration.transform.scale = [
  scalar(['settings', 'scale_x'], 240), scalar(['settings', 'scale_y'], 240), scalar(['settings', 'scale_z'], 35),
 ];
 configuration.transform.offset = [
  scalar(['settings', 'offset_x'], 0), scalar(['settings', 'offset_y'], 0), scalar(['settings', 'offset_z'], 0),
 ];
 configuration.transform.rotationDegrees = scalar(['settings', 'rotation'], 0);
 // JsonComplexRootsConfig clamps *after* float parsing. Infinities become
 // endpoints; NaN remains an explicit canonical admission error.
 configuration.dotSize = Math.max(Math.fround(.001), Math.min(Math.fround(.1), scalar(['settings', 'dot_size'], .01)));
 configuration.camera.phi = scalar(['camera', 'phi'], configuration.camera.phi);
 configuration.camera.theta = scalar(['camera', 'theta'], 0);
 configuration.camera.gamma = scalar(['camera', 'gamma'], 0);
 const prepared = prepareRootsPresentationConfiguration(configuration);
 return prepared.ok ? {ok: true, value: {configuration: prepared.value, diagnostics}} : prepared;
}
