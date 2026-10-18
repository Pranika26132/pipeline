import { describe, expect, it } from "vitest";

import { roleTiming } from "./roles";

const oct2026 = new Date("2026-10-18T12:00:00Z");

describe("roleTiming", () => {
  it.each([
    ["Summer 2026 SWE Intern ($60/hour + Free Housing & Food)", "past"],
    ["Software Engineering Intern, Summer '26", "past"],
    ["Spring 2026 Data Intern", "past"],
    ["Fall 2026 Quant Research Intern", "upcoming"],
    ["Summer 2027 SWE Intern", "upcoming"],
    ["Winter 2026 Intern", "upcoming"],
    ["2025 Engineering Internship", "past"],
    ["Software Engineer ($150k-$200k + equity)", "undated"],
    ["Software Engineering Intern", "undated"],
  ])("%s is %s in October 2026", (title, expected) => {
    expect(roleTiming(title, oct2026)).toBe(expected);
  });
});
