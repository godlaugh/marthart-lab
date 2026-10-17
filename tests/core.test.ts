import { describe, it, expect } from "vitest";
import { compileReal, random } from "../src/engine/expression";
import { parseScene } from "../src/engine/document";
describe("mathematical expression boundary", () => {
  it("evaluates implicit multiplication, powers, parameters and conditions", () => {
    expect(compileReal("2sin(pi/2) + a x^2")({ a: 3, x: 2 })).toBeCloseTo(14);
    expect(compileReal("x > 0 ? sqrt(x) : -sqrt(-x)")({ x: -9 })).toBe(-3);
  });
  it("rejects assignment, arbitrary calls and property access", () => {
    for (const s of ["x=3", 'import("x")', "x.constructor", "f(x)=x"])
      expect(() => compileReal(s)).toThrow();
    expect(() => compileReal("missing+1")({})).toThrow("未知变量");
  });
  it("uses reproducible seeded random sequences", () => {
    const a = random(42),
      b = random(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it("honors caller parameters named e and supports angular constants", () => {
    expect(compileReal("e*x")({ e: 9, x: 2 })).toBe(18);
    expect(compileReal("e")({})).toBe(Math.E);
    expect(compileReal("sin(TWO_PI)+cos(HALF_PI)")({})).toBeCloseTo(0);
  });
});
describe("document import", () => {
  it("rejects invalid formats and unbounded sizes", () => {
    expect(() => parseScene('{"version":99}')).toThrow();
    expect(() => parseScene(" ".repeat(8 * 1024 * 1024 + 1))).toThrow("8 MB");
  });
});
