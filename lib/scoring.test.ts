import { describe, expect, it } from "vitest";

import { placesMatch, roleMatches, schoolsMatch, scoreCompany, type ScoreInput } from "./scoring";

const TEAM = "https://acme.test/team";
const CAREERS = "https://acme.test/careers";
const ABOUT = "https://acme.test/about";

const profile: ScoreInput["profile"] = {
  school: "Duke",
  hometown: "Raleigh, NC",
  role_targets: ["Software engineering", "Quant research"],
  weight_school: 3,
  weight_hometown: 2,
  weight_open_role: 2,
  weight_early_stage: 1,
};

const emptyCompany: ScoreInput["company"] = { stage: null, size: null, open_roles: [], field_sources: {} };

function person(overrides: Partial<ScoreInput["contacts"][number]> = {}): ScoreInput["contacts"][number] {
  return { name: "Jane Doe", title: "CEO", school: null, hometown: null, source_url: TEAM, ...overrides };
}

describe("scoreCompany", () => {
  it("adds every matching factor with SPEC.md's default weights", () => {
    const result = scoreCompany({
      profile,
      company: {
        stage: "Seed",
        size: "11-50 employees",
        open_roles: [{ title: "Software Engineering Intern", location: "Durham, NC", source_url: CAREERS }],
        field_sources: { size: ABOUT, stage: ABOUT },
      },
      contacts: [person({ school: "Duke University", hometown: "Raleigh, North Carolina" })],
    });
    expect(result.score).toBe(3 + 2 + 2 + 1);
    expect(result.reasons).toEqual([
      { factor: "school", points: 3, text: "Jane Doe (CEO) went to Duke University", source_url: TEAM },
      { factor: "hometown", points: 2, text: "Jane Doe (CEO) is from Raleigh, North Carolina", source_url: TEAM },
      { factor: "open_role", points: 2, text: "Hiring: Software Engineering Intern", source_url: CAREERS },
      { factor: "early_stage", points: 1, text: "Small team: 11-50 employees", source_url: ABOUT },
    ]);
  });

  it("scores 0 with no reasons when nothing on the pages matches", () => {
    const result = scoreCompany({ profile, company: emptyCompany, contacts: [person({ school: "Stanford" })] });
    expect(result).toEqual({ score: 0, reasons: [] });
  });

  it("never uses a school or hometown that wasn't saved from a page", () => {
    // No school on the contact means nothing to match, even for a Duke-sounding name.
    const noSchool = scoreCompany({ profile, company: emptyCompany, contacts: [person({ name: "Duke Smith" })] });
    expect(noSchool.score).toBe(0);
    // A contact without a source page doesn't count.
    const noSource = scoreCompany({ profile, company: emptyCompany, contacts: [person({ school: "Duke", source_url: null })] });
    expect(noSource.score).toBe(0);
  });

  it("uses the profile's weights, and a weight of 0 drops the reason", () => {
    const result = scoreCompany({
      profile: { ...profile, weight_school: 0, weight_hometown: 3 },
      company: emptyCompany,
      contacts: [person({ school: "Duke", hometown: "Raleigh, NC" })],
    });
    expect(result.score).toBe(3);
    expect(result.reasons.map((r) => r.factor)).toEqual(["hometown"]);
  });

  it("counts a factor once, naming how many others match", () => {
    const result = scoreCompany({
      profile,
      company: emptyCompany,
      contacts: [person({ school: "Duke" }), person({ name: "Sam Lee", title: null, school: "Duke University" }), person({ name: "Ana Ruiz", school: "Duke Law" })],
    });
    expect(result.score).toBe(3);
    expect(result.reasons[0].text).toBe("Jane Doe (CEO) and 2 others went to Duke");
  });

  it("names an internship first among matching roles", () => {
    const result = scoreCompany({
      profile,
      company: {
        ...emptyCompany,
        open_roles: [
          { title: "Senior Software Engineer", location: null, source_url: CAREERS },
          { title: "Account Executive", location: null, source_url: CAREERS },
          { title: "Software Engineering Intern", location: null, source_url: CAREERS },
        ],
      },
      contacts: [],
    });
    expect(result.reasons[0].text).toBe("Hiring: Software Engineering Intern and 1 more matching role");
  });

  it("skips roles and facts without a usable source link", () => {
    const result = scoreCompany({
      profile,
      company: {
        stage: "Seed",
        size: "10 people",
        open_roles: [{ title: "Software Engineer", location: null, source_url: "javascript:alert(1)" }],
        field_sources: { size: "not a url" },
      },
      contacts: [],
    });
    expect(result.score).toBe(0);
  });

  it("works with an empty profile: only early stage can count", () => {
    const result = scoreCompany({
      profile: { ...profile, school: null, hometown: null, role_targets: [] },
      company: { ...emptyCompany, stage: "Seed", field_sources: { stage: ABOUT } },
      contacts: [person({ school: "Duke", hometown: "Raleigh, NC" })],
    });
    expect(result.reasons).toEqual([{ factor: "early_stage", points: 1, text: "Early stage: Seed", source_url: ABOUT }]);
  });

  it("decides early stage by headcount first, then funding stage", () => {
    const score = (size: string | null, stage: string | null) =>
      scoreCompany({ profile, company: { ...emptyCompany, size, stage, field_sources: { size: ABOUT, stage: ABOUT } }, contacts: [] }).score;
    expect(score("about 30 people", null)).toBe(1);
    expect(score("51-200 employees", "Seed")).toBe(0);
    expect(score("200+", null)).toBe(0);
    expect(score("1,000 employees", null)).toBe(0);
    expect(score(null, "Series A")).toBe(1);
    expect(score(null, "Series B")).toBe(0);
    expect(score("a small team", "Pre-seed")).toBe(1);
    // A YC company can be old and large.
    expect(score(null, "YC W09")).toBe(0);
    // Thousands and years aren't small teams.
    expect(score("1.2k employees", null)).toBe(0);
    expect(score("1k+ employees", null)).toBe(0);
    expect(score("Founded in 2015, 30 employees", null)).toBe(1);
  });
});

describe("schoolsMatch", () => {
  it.each([
    ["Duke", "Duke University"],
    ["Duke University", "Duke"],
    ["duke university", "Duke University School of Law"],
    ["Duke", "Duke's Fuqua School of Business"],
    ["MIT", "Massachusetts Institute of Technology"],
    ["UNC", "University of North Carolina at Chapel Hill"],
    ["NC State", "North Carolina State University"],
    ["Georgia Tech", "Georgia Institute of Technology"],
    ["College of William and Mary", "William & Mary"],
    ["Duke", "Stanford; Duke"],
    ["Duke", "Duke, Stanford"],
    ["Duke", "Duke University (BS)"],
    ["Duke", "Duke '19"],
    ["MIT", "MIT Sloan"],
    ["NYU", "NYU Stern School of Business"],
    ["UC Berkeley", "University of California, Berkeley"],
    ["The University of Michigan", "UMich"],
  ])("%s matches %s", (mine, theirs) => {
    expect(schoolsMatch(mine, theirs)).toBe(true);
  });

  it.each([
    ["University of North Carolina", "North Carolina State University"],
    ["NC State", "University of North Carolina at Chapel Hill"],
    ["Duke", "Duquesne University"],
    ["MIT", "Smith College"],
    ["Penn State", "University of Pennsylvania"],
    ["Columbia", "University of British Columbia"],
    ["", "Duke"],
    ["Boston College", "Boston University"],
    ["University of Miami", "Miami University"],
    ["University of Washington", "Washington University in St. Louis"],
    ["NYU", "New York Law School"],
    ["NYU", "New York Medical College"],
  ])("%s does not match %s", (mine, theirs) => {
    expect(schoolsMatch(mine, theirs)).toBe(false);
  });
});

describe("placesMatch", () => {
  it.each([
    ["Raleigh, NC", "Raleigh, North Carolina"],
    ["raleigh", "Raleigh, NC, USA"],
    ["North Carolina", "Durham, NC"],
    ["NC", "Chapel Hill, North Carolina"],
  ])("%s matches %s", (mine, theirs) => {
    expect(placesMatch(mine, theirs)).toBe(true);
  });

  it.each([
    ["Raleigh, NC", "Durham, NC"],
    ["Portland, OR", "Portland, ME"],
    ["Raleigh, NC", "North Carolina"],
    ["New York", "York, PA"],
    ["", "Raleigh"],
    // Which Raleigh isn't stated.
    ["Raleigh, North Carolina", "Raleigh"],
    ["Portland, OR", "Portland"],
    // Country codes, not states.
    ["Indiana", "Mumbai, IN"],
    ["Delaware", "Berlin, DE"],
    ["California", "Toronto, CA"],
    ["Washington", "Perth, WA"],
  ])("%s does not match %s", (mine, theirs) => {
    expect(placesMatch(mine, theirs)).toBe(false);
  });
});

describe("roleMatches", () => {
  it.each([
    ["Software engineering", "Software Engineer Intern"],
    ["Software engineering", "Backend Engineer"],
    ["Machine learning", "ML Engineer"],
    ["Data science", "Data Scientist, Summer Intern"],
    ["Quant research", "Quantitative Researcher Intern"],
    ["Quant trading", "Trading Intern"],
    ["Quant development", "Quantitative Developer"],
    ["Firmware", "Senior Firmware Engineer"],
    ["Software engineering", "SWE Intern"],
    ["Machine learning", "Research Scientist, AI"],
    ["Quant trading", "Quantitative Trading Intern"],
  ])("%s matches %s", (target, title) => {
    expect(roleMatches(target, title)).toBe(true);
  });

  it.each([
    ["Software engineering", "Account Executive"],
    ["Software engineering", "Hardware Engineer"],
    ["Quant research", "User Researcher"],
    ["Machine learning", "Email Marketing Lead"],
    ["Firmware", "Firm Operations"],
    ["Software engineering", "Software Sales Representative"],
    ["Machine learning", "Account Executive, AI"],
    ["Data science", "Marketing Analytics Manager"],
    ["Quant trading", "Trading Operations Associate"],
  ])("%s does not match %s", (target, title) => {
    expect(roleMatches(target, title)).toBe(false);
  });
});
