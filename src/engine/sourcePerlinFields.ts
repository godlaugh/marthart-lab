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
