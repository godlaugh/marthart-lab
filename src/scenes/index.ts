import { definitions as geometry } from "./geometry";
import { definitions as particles } from "./particles";
import { definitions as complex } from "./complex";
import type { SceneKind } from "../types";
export const definitions = [...geometry, ...particles, ...complex];
export function definition(kind: SceneKind) {
  const def = definitions.find((d) => d.kind === kind);
  if (!def) throw new Error(`未知场景 ${kind}`);
  return def;
}
