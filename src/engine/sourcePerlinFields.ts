/** Source field identities shared by import and numeric provenance validation. */
export const SOURCE_PERLIN_PARAMETER_NAMES=['noise_offset','noise_scale','curve_noise_scale','curve_angle_scale'] as const;
export const SOURCE_PERLIN_GPU_FLOAT_FIELDS = {
 noiseFrequency: 'gpu_noise_frequency', warpAmplitude: 'gpu_warp_amplitude', warpFrequency: 'gpu_warp_frequency',
 directionOffset: 'gpu_direction_offset', timeSpeed: 'gpu_time_speed', stepSize: 'gpu_step_size',
 brightness: 'gpu_brightness', vignettePower: 'gpu_vignette_power', fiberStrength: 'gpu_fiber_strength',
} as const;
export const SOURCE_PERLIN_GPU_INT_FIELDS = { marchSteps: 'gpu_march_steps', renderStyle: 'gpu_render_style' } as const;
/** Numeric lexeme slots owned by this importer, including numeric enum fallbacks. */
export const SOURCE_PERLIN_GPU_NUMBER_FIELDS=Object.freeze(['seed','cpu_render_style',...Object.values(SOURCE_PERLIN_GPU_FLOAT_FIELDS),...Object.values(SOURCE_PERLIN_GPU_INT_FIELDS),'gpu_texture_style',...SOURCE_PERLIN_PARAMETER_NAMES]);
/** JsonPerlinConfig CPU field identity owner. All scalar, integer, enum, bool
 * and color getters can consume a numeric JSON token, even when that value
 * selects a source fallback. Importers and persisted-provenance admission use
 * these same paths; this catalog does not reinterpret any field's value. */
export const SOURCE_PERLIN_CPU_FIELDS = {
 particles: {count:'particle_count',stepSize:'step_size',timeScale:'time_scale',respawnRate:'respawn_rate',flowMode:'flow_mode',angleMap:'angle_map'},
 curves: {count:'curve_count',length:'curve_length',stepSize:'curve_step_size',alpha:'curve_alpha',cellSize:'field_cell_size',noiseOctaves:'curve_noise_octaves',noiseOffset:'curve_noise_offset',sampling:'curve_sampling_mode',colorMode:'curve_color_mode',seedCircleCount:'seed_space_circle_count',seedMinRadius:'seed_space_min_radius',seedMaxRadius:'seed_space_max_radius'},
 display: {dotSize:'dot_size',lineWeight:'line_weight',trailLifetime:'trail_lifetime',fadeTrails:'fade_trails',showTrails:'show_trails',accumulation:'use_accumulation_buffer',accumulationFadeAlpha:'accumulation_fade_alpha',backgroundColor:'background_color'},
} as const;
export const SOURCE_PERLIN_CPU_NUMBER_FIELDS=Object.freeze(['seed','cpu_render_style','render_mode',...SOURCE_PERLIN_PARAMETER_NAMES,...Object.values(SOURCE_PERLIN_CPU_FIELDS.particles),...Object.values(SOURCE_PERLIN_CPU_FIELDS.curves),...Object.values(SOURCE_PERLIN_CPU_FIELDS.display)]);
export const SOURCE_PERLIN_NUMBER_FIELDS=Object.freeze([...new Set([...SOURCE_PERLIN_GPU_NUMBER_FIELDS,...SOURCE_PERLIN_CPU_NUMBER_FIELDS])]);
