/** Consumed constructor slots, shared with retained-number provenance without
 * making the JSON metadata validator import a complete configuration parser. */
export const SOURCE_SAMILA_MATH_FIELDS=['func_seed','seed','start','stop','generate_mode','projection'] as const;
export const SOURCE_SAMILA_PARAMETER_LIMIT=8192;

/** JsonSamilaConfig getter defaults, distinct from BaseSamilaConfig when the
 * whole settings object is absent. Runtime clamps belong to the frame owner. */
export const SOURCE_SAMILA_APPEARANCE_FIELDS={
 spot_size:{key:'samilaSpotSize',base:.01,json:.01},alpha:{key:'alpha',base:.1,json:.1},
 accumulation_decay:{key:'accumulationDecay',base:1,json:1},
 brightness:{key:'normalizedBrightness',base:.5,json:.3},contrast:{key:'normalizedContrast',base:1,json:1},
 gamma:{key:'normalizedGamma',base:2.2,json:2.2},dynamic_range:{key:'normalizedDynamicRange',base:.5,json:.2},
 saturation:{key:'normalizedSaturation',base:.8,json:.8},
 color_speed:{key:'colorSpeed',base:.22,json:.22},color_phase:{key:'colorPhase',base:180,json:180},
 trail_lifetime:{key:'trailLifetime',base:4,json:4},
} as const;
