/** Realtime recording resource policy, shared by all scene families. */
export const RECORDING_DURATION_MIN=.1,RECORDING_DURATION_MAX=3600;
export function recordingDurationError(value:number):string|undefined{return !Number.isFinite(value)||value<RECORDING_DURATION_MIN||value>RECORDING_DURATION_MAX?'录制时长须在 0.1–3600 秒之间；原值已保留，请修改后录制。':undefined;}
