import { describe, expect, it } from "vitest";

import { acceptFacts, type Quote, type ResearchPerson } from "./research";

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
    const found = acceptFacts([{ person: 1, kind: "school", value: "Duke University", quote: 1 }], people, quotes);
    expect(found).toEqual([
      { key: "a", school: { value: "Duke University", quote: quotes[0].text, url: "https://www.starterstory.com/x" } },
    ]);
  });

  it("drops a value the quote doesn't contain as whole words", () => {
    expect(acceptFacts([{ person: 1, kind: "school", value: "Stanford", quote: 1 }], people, quotes)).toEqual([]);
    expect(acceptFacts([{ person: 1, kind: "school", value: "Duke U", quote: 1 }], people, quotes)).toEqual([]);
  });

  it("drops a quote that doesn't name the person", () => {
    expect(acceptFacts([{ person: 1, kind: "hometown", value: "Raleigh", quote: 3 }], people, quotes)).toEqual([]);
  });

  it("never keeps a high school as a school", () => {
    expect(
      acceptFacts([{ person: 2, kind: "school", value: "Frisco Centennial High School", quote: 2 }], people, quotes),
    ).toEqual([]);
  });

  it("never credits one person's school to another named in the same quote", () => {
    // Quote 1 names both: Duke is Sarthak's, Northwestern is Rudy's.
    expect(acceptFacts([{ person: 2, kind: "school", value: "Duke University", quote: 1 }], people, quotes)).toEqual([]);
    expect(acceptFacts([{ person: 1, kind: "school", value: "Northwestern University", quote: 1 }], people, quotes)).toEqual([]);
    const right = acceptFacts([{ person: 2, kind: "school", value: "Northwestern University", quote: 1 }], people, quotes);
    expect(right[0]).toMatchObject({ key: "b", school: { value: "Northwestern University" } });
  });

  it("doesn't treat a name particle as naming the person", () => {
    const ana: ResearchPerson[] = [{ key: "c", name: "Ana de Souza", title: null, needSchool: true, needHometown: true }];
    const q: Quote[] = [{ text: "The lab partnered with Universidade de São Paulo last year.", url: "https://example.com/z" }];
    expect(acceptFacts([{ person: 1, kind: "school", value: "Universidade de São Paulo", quote: 1 }], ana, q)).toEqual([]);
  });

  it("ignores made-up person or quote numbers", () => {
    expect(acceptFacts([{ person: 9, kind: "school", value: "Duke", quote: 1 }], people, quotes)).toEqual([]);
    expect(acceptFacts([{ person: 1, kind: "school", value: "Duke", quote: 0 }], people, quotes)).toEqual([]);
  });

  it("skips a fact the person already has, and keeps the first of each kind", () => {
    const haveSchool = [{ ...people[0], needSchool: false }, people[1]];
    expect(acceptFacts([{ person: 1, kind: "school", value: "Duke University", quote: 1 }], haveSchool, quotes)).toEqual([]);
    const found = acceptFacts(
      [
        { person: 1, kind: "school", value: "Duke University", quote: 4 },
        { person: 1, kind: "school", value: "Duke University", quote: 1 },
        { person: 1, kind: "hometown", value: "Frisco, Texas", quote: 4 },
      ],
      people,
      quotes,
    );
    expect(found[0].school?.url).toBe("https://dailynorthwestern.com/y");
    expect(found[0].hometown?.value).toBe("Frisco, Texas");
  });
});
