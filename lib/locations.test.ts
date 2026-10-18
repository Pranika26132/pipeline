import { describe, expect, it } from "vitest";

import { mergeLocations, withoutLookupRoles, type CompanyLocation } from "./locations";
import { regionsMatch, scoreCompany, type ScoreInput } from "./scoring";

const office = (value: string, from: CompanyLocation["from"] = "lookup"): CompanyLocation => ({
  value,
  quote: `Our office is in ${value}.`,
  source_url: "https://acme.test/about",
  kind: "office",
  from,
});

describe("mergeLocations", () => {
  it("keeps everything already saved and adds only new places", () => {
    const fromFind = [office("Minneapolis, Minnesota", "find")];
    const merged = mergeLocations(fromFind, [office("Minneapolis, Minnesota"), office("New York, NY")]);
    expect(merged.map((l) => `${l.value}/${l.from}`)).toEqual(["Minneapolis, Minnesota/find", "New York, NY/lookup"]);
    // A lookup that finds nothing leaves the list as it was.
    expect(mergeLocations(fromFind, [])).toEqual(fromFind);
  });
  it("drops malformed entries", () => {
    expect(mergeLocations([{ value: "X" }, office("Austin, TX"), "junk"], [])).toHaveLength(1);
  });
});

describe("regionsMatch", () => {
  it("matches the same place or the same state as the profile's city", () => {
    expect(regionsMatch("Minnesota", "Minneapolis, MN")).toBe(true);
    expect(regionsMatch("Minneapolis, MN", "St. Paul, Minnesota")).toBe(true);
    expect(regionsMatch("Raleigh, NC", "Durham, North Carolina")).toBe(true);
    expect(regionsMatch("Raleigh, NC", "Austin, TX")).toBe(false);
    // Zip codes and street numbers in a footer address don't matter.
    expect(regionsMatch("Minneapolis, MN", "10 2nd Street NE #103, Minneapolis, MN 55413")).toBe(true);
    // A code written the way the user wrote theirs is the same state.
    expect(regionsMatch("Boston, MA", "Cambridge, MA")).toBe(true);
    // The state comes after the city: Washington, DC is not Washington state.
    expect(regionsMatch("Seattle, WA", "Washington, DC")).toBe(false);
    expect(regionsMatch("London, Ontario", "Ontario, California")).toBe(false);
    // A country is too broad to be a region.
    expect(regionsMatch("Mumbai, India", "Bangalore, India")).toBe(false);
    // A bare city name could be anywhere, the same rule as hometowns.
    expect(regionsMatch("Minneapolis, MN", "Minneapolis")).toBe(false);
  });
});

describe("Nearby factor", () => {
  const profile: ScoreInput["profile"] = {
    school: null,
    hometown: "Minneapolis, MN",
    role_targets: [],
    weight_school: 3,
    weight_hometown: 2,
    weight_open_role: 2,
    weight_early_stage: 1,
    weight_region: 1,
  };
  const company = { stage: null, size: null, open_roles: [], field_sources: {} };
  it("adds points for an office in the profile's state, with its source", () => {
    const r = scoreCompany({ profile, company: { ...company, locations: [office("St. Paul, Minnesota", "find")] }, contacts: [] });
    expect(r.reasons).toEqual([{ factor: "region", points: 1, text: "Office in St. Paul, Minnesota", source_url: "https://acme.test/about" }]);
  });
  it("needs a source and a matching place, and respects a weight of 0", () => {
    expect(scoreCompany({ profile, company: { ...company, locations: [{ ...office("Minneapolis, MN"), source_url: "" }] }, contacts: [] }).score).toBe(0);
    expect(scoreCompany({ profile, company: { ...company, locations: [office("Austin, TX")] }, contacts: [] }).score).toBe(0);
    expect(scoreCompany({ profile: { ...profile, weight_region: 0 }, company: { ...company, locations: [office("Minneapolis, MN")] }, contacts: [] }).score).toBe(0);
  });
});

describe("withoutLookupRoles", () => {
  it("drops the last lookup's role locations but keeps offices and Find's", () => {
    const role = { value: "Austin, TX", quote: null, source_url: "https://a.test/careers", kind: "role" as const, from: "lookup" as const };
    const kept = withoutLookupRoles([office("Minneapolis, MN", "find"), office("Austin, TX"), role]);
    expect(kept.map((l) => `${l.kind}/${l.from}`)).toEqual(["office/find", "office/lookup"]);
  });
});
