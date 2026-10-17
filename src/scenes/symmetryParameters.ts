/** Authored built-in defaults shared by generation, scene creation and explicit
 * template selection. Custom GLSL uniforms never receive these implicitly. */
export const SYMMETRY_DEFAULT_PARAMETERS=Object.freeze({lambda:-2.34,alpha:2,beta:.2,gamma:.2,omega:0,delta:0});
export const SYMMETRY_DEFAULT_SETTINGS=Object.freeze({degree:5,template:'standard' as const,deltaPower:1});
