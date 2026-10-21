/** Source field contract shared by import and numeric provenance. No parser dependencies. */
export const SOURCE_MAP_PRESENTATION_FIELDS=[
 ['brightness','normalizedBrightness',.3,-.5,1.5],
 ['contrast','normalizedContrast',1,.1,2],
 ['gamma','normalizedGamma',2.2,.1,10],
 ['dynamic_range','normalizedDynamicRange',.2,.1,1],
 ['saturation','normalizedSaturation',.8,0,1],
 ['accumulation_decay','accumulationDecay',1],
] as const;
export const SOURCE_MAP_PRESENTATION_NUMBER_FIELDS:readonly string[]=[...SOURCE_MAP_PRESENTATION_FIELDS.map(spec=>spec[0]),'background_color'];
