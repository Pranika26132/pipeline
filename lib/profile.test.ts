import { describe, expect, it } from "vitest";

import { levelFor, WEIGHTS } from "./profile";

describe("score weight choices", () => {
  it("default choices give SPEC.md's points: school 3, hometown 2, open role 2, early stage 1", () => {
    const points = Object.fromEntries(WEIGHTS.map((w) => [w.key, w.points[w.fallback]]));
    expect(points).toEqual({ weight_school: 3, weight_hometown: 2, weight_open_role: 2, weight_early_stage: 1 });
  });

  it("\"Doesn't matter\" is 0 for every factor", () => {
    for (const w of WEIGHTS) expect(w.points.none).toBe(0);
  });

  it("stored points read back as the same choice", () => {
    for (const w of WEIGHTS) {
      for (const level of ["none", "matters", "a_lot"] as const) {
        expect(levelFor(w.key, w.points[level])).toBe(level);
      }
    }
  });

  it("no saved profile shows the default choice", () => {
    expect(levelFor("weight_school", undefined)).toBe("a_lot");
    expect(levelFor("weight_early_stage", null)).toBe("matters");
  });

  it("other stored numbers show as the nearest choice", () => {
    expect(levelFor("weight_school", 10)).toBe("a_lot");
    expect(levelFor("weight_hometown", 1)).toBe("matters");
    expect(levelFor("weight_early_stage", 7)).toBe("a_lot");
  });
});
