/** Exact spatial leaves consumed by JsonComplexRootsConfig and Scene. Keep
 * this registry independent of parsers so numeric provenance has no import
 * cycle through the source integer or presentation owners. */
export const ROOTS_PRESENTATION_SCALAR_PATHS = [
 ['settings', 'scale_x'], ['settings', 'scale_y'], ['settings', 'scale_z'],
 ['settings', 'offset_x'], ['settings', 'offset_y'], ['settings', 'offset_z'],
 ['settings', 'rotation'], ['settings', 'dot_size'],
 ['camera', 'phi'], ['camera', 'theta'], ['camera', 'gamma'],
] as const;
export const ROOTS_PRESENTATION_INTEGER_PATHS = [['settings', 'max_splat_points_per_frame']] as const;
/** The existing sampling importer accepts these aliases. They address one
 * consumed value, not two independent source settings. */
export const ROOTS_BATCH_SIZE_SOURCE_PATHS = [['sampling', 'batch_size'], ['sampling', 'batchSize']] as const;
