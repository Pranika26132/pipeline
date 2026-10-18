import { describe, expect, it } from "vitest";

import { canCheckFit, currentFits, fitFor, fitKey, isSeniorTitle, mergeVerdicts } from "./fit";

const URL = "https://acme.test/careers";
const profile = { role_targets: ["Software engineering"], degree: "BS", major: "Computer Science", grad_year: 2028, resume: "Built a compiler." };

describe("fitKey", () => {
  it("is stable across role order and case, and changes with anything fit depends on", () => {
    const key = fitKey(profile);
    expect(fitKey({ ...profile, role_targets: ["software ENGINEERING"] })).toBe(key);
    expect(fitKey({ ...profile, major: "Economics" })).not.toBe(key);
    expect(fitKey({ ...profile, grad_year: 2027 })).not.toBe(key);
    expect(fitKey({ ...profile, resume: "Built a game." })).not.toBe(key);
    expect(fitKey({ ...profile, role_targets: ["Quant research"] })).not.toBe(key);
  });
});

describe("currentFits", () => {
  const record = { key: fitKey(profile), checked_at: "x", roles: [{ title: "SWE Intern", source_url: URL, verdict: "fits", reason: "Fits." }] };
  it("returns verdicts only for the current profile", () => {
    expect(currentFits(record, fitKey(profile))).toHaveLength(1);
    expect(currentFits(record, fitKey({ ...profile, major: "Math" }))).toBeNull();
    expect(currentFits(null, fitKey(profile))).toBeNull();
  });
  it("drops malformed entries", () => {
    const bad = { ...record, roles: [...record.roles, { title: "X", source_url: URL, verdict: "great", reason: "" }, "junk"] };
    expect(currentFits(bad, fitKey(profile))).toHaveLength(1);
    expect(fitFor(currentFits(bad, fitKey(profile)), { title: "SWE Intern", source_url: URL })?.verdict).toBe("fits");
  });
});

describe("isSeniorTitle", () => {
  it("catches senior and experienced-hire titles", () => {
    expect(isSeniorTitle("Senior Software Engineer")).toBe(true);
    expect(isSeniorTitle("Staff Engineer")).toBe(true);
    expect(isSeniorTitle("Engineering Manager")).toBe(true);
    expect(isSeniorTitle("Backend Engineer (5+ years)")).toBe(true);
    expect(isSeniorTitle("Software Engineering Intern")).toBe(false);
    expect(isSeniorTitle("New Grad Software Engineer")).toBe(false);
  });
});

describe("mergeVerdicts", () => {
  const list = [
    { title: "A", source_url: URL },
    { title: "B", source_url: URL },
    { title: "C", source_url: URL },
  ];
  it("pairs answers by index; a missing or invalid answer is unclear", () => {
    const merged = mergeVerdicts(list, [null, null, { title: "C", source_url: URL, verdict: "past", reason: "Dates passed." }], [
      { index: 0, verdict: "fits", reason: "Internship; fits your major." },
      { index: 1, verdict: "awesome", reason: "?" },
      { index: 2, verdict: "fits", reason: "Ignored: decided already." },
    ]);
    expect(merged.map((m) => m.verdict)).toEqual(["fits", "unclear", "past"]);
    expect(merged[0].reason).toBe("Internship; fits your major.");
  });
});

describe("canCheckFit", () => {
  it("needs target roles", () => {
    expect(canCheckFit(profile)).toBe(true);
    expect(canCheckFit({ ...profile, role_targets: [] })).toBe(false);
    expect(canCheckFit(null)).toBe(false);
  });
});
