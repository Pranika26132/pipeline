import { describe, expect, it } from "vitest";

import { acceptConnections, checkCandidates, mergeVerified, namesCompany, parseCandidates, urlKey, withBackedWhy } from "./find";

describe("parseCandidates", () => {
  it("reads the last <companies> block and drops incomplete rows", () => {
    const text =
      'Searching… <companies>[{"name":"Old"}]</companies> final: <companies>[{"name":"Acme","website":"https://acme.test","why":"Quant, NYC","source_url":"https://news.test/a"},{"name":"NoSite","why":"x","source_url":"https://news.test/b"}]</companies>';
    expect(parseCandidates(text)).toEqual([{ name: "Acme", website: "https://acme.test", why: "Quant, NYC", source_url: "https://news.test/a" }]);
  });
  it("says so when the list is missing or broken", () => {
    expect(() => parseCandidates("no list here")).toThrow(/didn't include a list/);
    expect(() => parseCandidates("<companies>[{</companies>")).toThrow(/valid JSON/);
  });
});

describe("urlKey", () => {
  it("ignores a trailing slash and fragment", () => {
    expect(urlKey("https://a.test/x/#top")).toBe(urlKey("https://a.test/x"));
  });
});

describe("namesCompany", () => {
  it("accepts the name or the domain's main label as whole words", () => {
    expect(namesCompany("Welcome to Acme Trading. We build…", "Acme Trading", "acmetrading.com")).toBe(true);
    expect(namesCompany("The Oxide rack", "Oxide Computer Company", "oxide.computer")).toBe(true);
    expect(namesCompany("Domain for sale", "Acme", "acme.com")).toBe(false);
    // "io" is too short to count as a match.
    expect(namesCompany("an io library", "Zzz", "io.dev")).toBe(false);
  });
});

describe("checkCandidates", () => {
  const results = new Set([urlKey("https://news.test/a")]);
  it("drops invented sources, directories, LinkedIn, duplicates and companies already listed, saying why", async () => {
    const { checked, leftOut } = await checkCandidates(
      [
        { name: "Made Up", website: "https://madeup.test", why: "", source_url: "https://elsewhere.test/z" },
        { name: "On YC", website: "https://www.ycombinator.com/companies/x", why: "", source_url: "https://news.test/a" },
        { name: "Li", website: "https://linkedin.com/company/x", why: "", source_url: "https://news.test/a" },
        { name: "Mine", website: "https://mine.test", why: "", source_url: "https://news.test/a" },
      ],
      results,
      new Set(["mine.test"]),
    );
    expect(checked).toEqual([]);
    expect(leftOut).toHaveLength(4);
    expect(leftOut[0]).toMatch(/not found in the search results/);
    expect(leftOut[3]).toMatch(/already in your list/);
  });
});

describe("mergeVerified", () => {
  const checked = [
    { candidate: { name: "A", website: "", why: "search why", source_url: "https://news.test/a" }, url: "https://a.test/", domain: "a.test", pageText: "A" },
    { candidate: { name: "B", website: "", why: "", source_url: "https://news.test/a" }, url: "https://b.test/", domain: "b.test", pageText: "B" },
    { candidate: { name: "C", website: "", why: "", source_url: "https://news.test/a" }, url: "https://c.test/", domain: "c.test", pageText: "C" },
  ];
  it("keeps only companies whose page describes them and doesn't contradict the request", () => {
    const { companies, leftOut } = mergeVerified(checked, {
      companies: [
        { index: 0, describes: true, description: "Builds trading tools.", why: "" },
        { index: 1, describes: false, description: "", why: "" },
        { index: 2, describes: true, contradicts: true, description: "A bakery in Ohio.", why: "Based in Ohio, not NYC." },
      ],
    });
    expect(companies.map((c) => c.name)).toEqual(["A"]);
    // The search step's note is never shown: it isn't checked.
    expect(companies[0].why).toBe("");
    expect(leftOut).toEqual(["B: its home page doesn't say what it does.", "C: doesn't meet your request. Based in Ohio, not NYC."]);
  });
});

describe("urlKey across scheme and www", () => {
  it("treats http/https and www as the same page, keeping the query", () => {
    expect(urlKey("http://www.News.test/a/?id=1")).toBe(urlKey("https://news.test/a?id=1"));
    expect(urlKey("https://news.test/a?id=1")).not.toBe(urlKey("https://news.test/a?id=2"));
  });
});

describe("acceptConnections", () => {
  const profile = { school: "University of Minnesota", hometown: "Minneapolis, MN", interests: [], role_targets: [] };
  const page = {
    url: "https://acme.test/",
    text: "Acme builds lab robots. Our headquarters is in St. Paul, Minnesota. Jane Doe, CEO, studied at the University of Minnesota. Jane Doe and Sam Lee grew up in Minneapolis, MN.",
  };
  const quotes = [{ text: "Sam Lee, Acme's CTO, is from Minneapolis, MN.", url: "https://news.test/acme" }];

  it("keeps quoted, sourced connections that match the profile", () => {
    const out = acceptConnections(
      [
        { kind: "office", value: "St. Paul, Minnesota", person: "", quote: "Our headquarters is in St. Paul, Minnesota." },
        { kind: "school", value: "University of Minnesota", person: "Jane Doe", quote: "Jane Doe, CEO, studied at the University of Minnesota." },
        { kind: "hometown", value: "Minneapolis, MN", person: "Sam Lee", quote: "Sam Lee, Acme's CTO, is from Minneapolis, MN." },
      ],
      page,
      quotes,
      profile,
    );
    expect(out.map((c) => `${c.kind}:${c.value}:${c.source_url}`)).toEqual([
      "office:St. Paul, Minnesota:https://acme.test/",
      "school:University of Minnesota:https://acme.test/",
      "hometown:Minneapolis, MN:https://news.test/acme",
    ]);
  });

  it("drops a claim with no exact quote, a quote about several people, or a place that isn't the user's", () => {
    const out = acceptConnections(
      [
        // Paraphrased, not on any page.
        { kind: "office", value: "Minnesota", person: "", quote: "The company is based in Minnesota." },
        // A sentence about two people: "shared", as in founder research.
        { kind: "hometown", value: "Minneapolis, MN", person: "Jane Doe", quote: "Jane Doe and Sam Lee grew up in Minneapolis, MN." },
        // Real quote, but not the user's region.
        { kind: "office", value: "Austin, Texas", person: "", quote: "Acme builds lab robots." },
      ],
      page,
      quotes,
      profile,
    );
    expect(out).toEqual([]);
  });
});

describe("withBackedWhy", () => {
  const profile = { school: "Duke University", hometown: "Minneapolis, MN", interests: [], role_targets: [] };
  const office = { kind: "office" as const, value: "Minneapolis, MN", person: null, quote: "10 2nd St NE, Minneapolis, MN 55413", source_url: "https://a.test/" };
  it("drops a reason that claims the user's region without a quoted connection", () => {
    expect(withBackedWhy("Minneapolis-based AI startup with seed funding.", [], profile).why).toBe("");
    expect(withBackedWhy("Has a Minnesota connection.", [], profile).why).toBe("");
    expect(withBackedWhy("Founded by a Duke University alum.", [], profile).why).toBe("");
  });
  it("keeps it when a connection backs it, or when it doesn't mention them", () => {
    expect(withBackedWhy("Minneapolis AI startup.", [office], profile).why).toBe("Minneapolis AI startup.");
    expect(withBackedWhy("Minnesota AI startup.", [office], profile).why).toBe("Minnesota AI startup.");
    expect(withBackedWhy("Seed-stage AI startup; not confirmed: interns.", [], profile).why).toBe("Seed-stage AI startup; not confirmed: interns.");
  });
});
