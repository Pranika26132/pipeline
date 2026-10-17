import { describe, expect, it } from "vitest";

import { aboutOnly, acceptFacts, acceptLeaders, mentionsCompany, resolveFact, type Quote, type ResearchPerson } from "./research";

const people: ResearchPerson[] = [
  { key: "a", name: "Sarthak Dhawan", title: "Co-founder", needSchool: true, needHometown: true },
  { key: "b", name: "Rudy Arora", title: "Co-founder", needSchool: true, needHometown: true },
];
const quotes: Quote[] = [
  { text: "Sarthak is currently an undergraduate at Duke University, while Rudy studies at Northwestern University.", url: "https://www.starterstory.com/x" },
  { text: "Rudy attended Frisco Centennial High School before Northwestern.", url: "https://example.com/rudy" },
  { text: "The company has offices in Raleigh and New York.", url: "https://example.com/about" },
  { text: "Former Duke University student Sarthak Dhawan grew up in Frisco, Texas.", url: "https://dailynorthwestern.com/y" },
];

describe("acceptFacts", () => {
  it("keeps a school the quote states for that person, with the quote and its page", () => {
    const found = acceptFacts([{ person: "Sarthak Dhawan", kind: "school", value: "Duke University", quote: 4 }], people, quotes);
    expect(found).toEqual([
      {
        key: "a",
        school: [{ value: "Duke University", quote: quotes[3].text, url: "https://dailynorthwestern.com/y", single: true }],
        hometown: [],
      },
    ]);
  });

  it("drops a value the quote doesn't contain as whole words", () => {
    expect(acceptFacts([{ person: "Sarthak Dhawan", kind: "school", value: "Stanford", quote: 1 }], people, quotes)).toEqual([]);
    expect(acceptFacts([{ person: "Sarthak Dhawan", kind: "school", value: "Duke U", quote: 1 }], people, quotes)).toEqual([]);
  });

  it("drops a quote that doesn't name the person", () => {
    expect(acceptFacts([{ person: "Sarthak Dhawan", kind: "hometown", value: "Raleigh", quote: 3 }], people, quotes)).toEqual([]);
  });

  it("never keeps a high school as a school", () => {
    expect(
      acceptFacts([{ person: "Rudy Arora", kind: "school", value: "Frisco Centennial High School", quote: 2 }], people, quotes),
    ).toEqual([]);
  });

  it("never credits one person's school to another named in the same quote", () => {
    // Quote 1 names both: Duke is Sarthak's, Northwestern is Rudy's.
    expect(acceptFacts([{ person: "Rudy Arora", kind: "school", value: "Duke University", quote: 1 }], people, quotes)).toEqual([]);
    expect(acceptFacts([{ person: "Sarthak Dhawan", kind: "school", value: "Northwestern University", quote: 1 }], people, quotes)).toEqual([]);
    const right = acceptFacts([{ person: "Rudy Arora", kind: "school", value: "Northwestern University", quote: 1 }], people, quotes);
    expect(right[0].school[0]).toMatchObject({ value: "Northwestern University" });
  });

  it("marks a sentence about several people as not single", () => {
    const q: Quote[] = [
      { text: "Arora and Dhawan were students at Duke University when they started Turbo AI.", url: "https://brut.example/a" },
    ];
    // Only Rudy is being researched; Dhawan is named but not a target.
    const found = acceptFacts([{ person: "Rudy Arora", kind: "school", value: "Duke University", quote: 1 }], [people[1]], q, [
      "Sarthak Dhawan",
    ]);
    expect(found[0].school[0].single).toBe(false);
    expect(resolveFact("school", found[0].school)?.status).toBe("shared");
  });

  it("doesn't call a school with 'and' in its name a sentence about several people", () => {
    expect(aboutOnly("Jane Doe graduated from the College of William and Mary.", "Jane Doe", "College of William and Mary", [])).toBe(true);
    expect(aboutOnly("Jane Doe and John Roe both went to Duke.", "Jane Doe", "Duke", [])).toBe(false);
    expect(aboutOnly("They met at Duke, where Jane Doe studied math.", "Jane Doe", "Duke", [])).toBe(false);
  });

  it("counts a part of a sentence that's clearly about one person", () => {
    const q = "Sarthak is currently an undergraduate at Duke University, while Rudy studies at Northwestern University.";
    expect(aboutOnly(q, "Sarthak Dhawan", "Duke University", ["Rudy Arora"])).toBe(true);
    expect(aboutOnly(q, "Rudy Arora", "Northwestern University", ["Sarthak Dhawan"])).toBe(true);
    expect(aboutOnly(q, "Rudy Arora", "Duke University", ["Sarthak Dhawan"])).toBe(false);
    const described = "The startup, co-founded by Rudy Arora and former Duke University student Sarthak Dhawan, helps students.";
    expect(aboutOnly(described, "Sarthak Dhawan", "Duke University", ["Rudy Arora"])).toBe(true);
    expect(aboutOnly(described, "Rudy Arora", "Duke University", ["Sarthak Dhawan"])).toBe(false);
    expect(aboutOnly("Arora and Dhawan were students at Duke University.", "Sarthak Dhawan", "Duke University", ["Rudy Arora"])).toBe(false);
  });

  it("ignores made-up people or quote numbers", () => {
    expect(acceptFacts([{ person: "Nobody Here", kind: "school", value: "Duke", quote: 1 }], people, quotes)).toEqual([]);
    expect(acceptFacts([{ person: "Sarthak Dhawan", kind: "school", value: "Duke", quote: 0 }], people, quotes)).toEqual([]);
  });

  it("skips a fact the person already has, and keeps every distinct sentence", () => {
    const haveSchool = [{ ...people[0], needSchool: false }, people[1]];
    expect(acceptFacts([{ person: "Sarthak Dhawan", kind: "school", value: "Duke University", quote: 4 }], haveSchool, quotes)).toEqual([]);
    const found = acceptFacts(
      [
        { person: "Sarthak Dhawan", kind: "school", value: "Duke University", quote: 4 },
        { person: "Sarthak Dhawan", kind: "school", value: "Duke University", quote: 4 },
        { person: "Sarthak Dhawan", kind: "hometown", value: "Frisco, Texas", quote: 4 },
      ],
      people,
      quotes,
    );
    expect(found[0].school).toHaveLength(1);
    expect(found[0].hometown[0].value).toBe("Frisco, Texas");
  });
});

describe("resolveFact", () => {
  const e = (value: string, single: boolean, url = `https://x.example/${value}`) => ({ value, quote: `q ${value}`, url, single });

  it("is stated when a single-person sentence says it and nothing disagrees", () => {
    expect(resolveFact("school", [e("Duke University", true), e("Duke", false)])).toMatchObject({
      value: "Duke University",
      status: "stated",
    });
  });

  it("is shared when only sentences about several people say it", () => {
    expect(resolveFact("school", [e("Duke University", false)])?.status).toBe("shared");
  });

  it("is conflicting when sources disagree, even if one is single-person", () => {
    const answer = resolveFact("school", [e("Duke University", false), e("Northwestern University", true)]);
    expect(answer).toMatchObject({ status: "conflicting", value: "Northwestern University" });
  });

  it("treats the same place written two ways as agreeing", () => {
    expect(resolveFact("hometown", [e("Frisco, Texas", true), e("Frisco, TX", false)])?.status).toBe("stated");
    expect(resolveFact("hometown", [e("Frisco, Texas", true), e("Austin, Texas", true)])?.status).toBe("conflicting");
  });
});

describe("acceptLeaders", () => {
  const turbo = { name: "turbo.ai", domain: "turbo.ai" };
  const found: Quote[] = [
    { text: "Turbo AI was co-founded by Rudy Arora and Sarthak Dhawan while they were in college.", url: "https://techcrunch.com/a" },
    { text: "Sarthak Dhawan, co-founder of TurboTax Helpers, spoke at the event.", url: "https://example.com/other" },
    { text: "Turbo AI has 5 million users. Sarthak Dhawan said the team keeps growing.", url: "https://example.com/quote" },
    { text: "Founded in 2024, Turbo AI hired Jane Smith as an engineer.", url: "https://example.com/hire" },
  ];

  it("keeps a founder named as such in a quote about this company", () => {
    const leaders = acceptLeaders(
      [
        { name: "Rudy Arora", role: "co-founder", quote: 1 },
        { name: "Sarthak Dhawan", role: "co-founder", quote: 1 },
      ],
      found,
      turbo,
      [],
    );
    expect(leaders.map((l) => [l.name, l.title, l.url])).toEqual([
      ["Rudy Arora", "Co-founder", "https://techcrunch.com/a"],
      ["Sarthak Dhawan", "Co-founder", "https://techcrunch.com/a"],
    ]);
  });

  it("reads founded-by and name-founded sentences", () => {
    const q: Quote[] = [
      { text: "Sarthak Dhawan and Rudy Arora co-founded Turbo AI in 2023.", url: "https://a.example/1" },
      { text: "Turbo AI, founded by Rudy Arora, makes study tools.", url: "https://a.example/2" },
    ];
    const both = acceptLeaders(
      [
        { name: "Sarthak Dhawan", role: "co-founder", quote: 1 },
        { name: "Rudy Arora", role: "co-founder", quote: 1 },
      ],
      q,
      turbo,
      [],
    );
    expect(both.map((l) => l.title)).toEqual(["Co-founder", "Co-founder"]);
    expect(acceptLeaders([{ name: "Rudy Arora", role: "founder", quote: 2 }], q, turbo, [])[0]?.title).toBe("Founder");
    const described: Quote[] = [
      { text: "The startup Turbo AI, co-founded by Rudy Arora and former Duke University student Sarthak Dhawan, helps students.", url: "https://a.example/3" },
      { text: "Turbo AI was founded by Rudy Arora, who later hired Jane Smith.", url: "https://a.example/4" },
    ];
    expect(acceptLeaders([{ name: "Sarthak Dhawan", role: "co-founder", quote: 1 }], described, turbo, [])[0]?.title).toBe("Co-founder");
    expect(acceptLeaders([{ name: "Jane Smith", role: "founder", quote: 2 }], described, turbo, [])).toEqual([]);
  });

  it("drops a founder of a different company, someone not called a founder, and a role far from the name", () => {
    expect(acceptLeaders([{ name: "Sarthak Dhawan", role: "co-founder", quote: 2 }], found, turbo, [])).toEqual([]);
    expect(acceptLeaders([{ name: "Sarthak Dhawan", role: "founder", quote: 3 }], found, turbo, [])).toEqual([]);
    expect(acceptLeaders([{ name: "Jane Smith", role: "founder", quote: 4 }], found, turbo, [])).toEqual([]);
  });

  it("drops single names, made-up quote numbers and people already saved", () => {
    expect(acceptLeaders([{ name: "Rudy", role: "co-founder", quote: 1 }], found, turbo, [])).toEqual([]);
    expect(acceptLeaders([{ name: "Rudy Arora", role: "co-founder", quote: 7 }], found, turbo, [])).toEqual([]);
    expect(acceptLeaders([{ name: "Rudy Arora", role: "co-founder", quote: 1 }], found, turbo, [people[1]])).toEqual([]);
  });

  it("accepts the company named in the page title or address when the quote doesn't name it", () => {
    const q: Quote[] = [
      {
        text: "The startup, co-founded by Rudy Arora and Sarthak Dhawan, helps students study.",
        url: "https://techcrunch.com/2025/10/23/ai-notetaker-turbo-ai-to-5-million-users/",
        title: "Dropouts built AI notetaker",
      },
      { text: "The startup, co-founded by Rudy Arora, helps students.", url: "https://example.com/story", title: "A startup story" },
    ];
    expect(acceptLeaders([{ name: "Rudy Arora", role: "co-founder", quote: 1 }], q, turbo, [])).toHaveLength(1);
    expect(acceptLeaders([{ name: "Rudy Arora", role: "co-founder", quote: 2 }], q, turbo, [])).toEqual([]);
  });

  it("recognizes the company by name, website, or website label", () => {
    expect(mentionsCompany("turbo ai is growing", turbo)).toBe(true);
    expect(mentionsCompany("visit turbo.ai today", turbo)).toBe(true);
    expect(mentionsCompany("turbotax is a product", turbo)).toBe(false);
    const restor = { name: "restor3d.com", domain: "restor3d.com" };
    expect(mentionsCompany("restor3d raised a series c", restor)).toBe(true);
    expect(mentionsCompany("restore 3d printing shop", restor)).toBe(false);
  });
});
