import { describe, expect, it } from "vitest";

import { availableHooks, checkDraft, draftFacts, gmailComposeUrl, wordCount, type DraftInput } from "./drafts";

const input: DraftInput = {
  company: {
    name: "Turbo AI",
    summary: "An AI note-taker for students.",
    stage: null,
    size: null,
    open_roles: [{ title: "Software Engineering Intern", location: "Remote", source_url: "https://turbo.ai/careers" }],
    score_reasons: [{ factor: "school", points: 3, text: "Sarthak Dhawan (Co-founder) went to Duke University", source_url: "https://x.example/a" }],
    field_sources: { summary: "https://turbo.ai/" },
  },
  contact: { name: "Rudy Arora", title: "Co-founder", school: "Duke University", hometown: "Frisco, Texas", schoolCounts: false, hometownCounts: true },
  profile: { school: "Duke University", hometown: "Raleigh, NC", interests: ["tech"], role_targets: ["Software engineering"] },
};
const facts = draftFacts(input);
const good = {
  subject: "Duke student interested in a software internship",
  body: "Hi Rudy,\n\nI'm a Duke student looking for a software engineering internship, and I saw Turbo AI lists a Software Engineering Intern role. Would you have 15 minutes this month to tell me what the team looks for?\n\nBest,",
};

describe("draftFacts", () => {
  it("lists company, person and profile facts, and leaves out a person fact that doesn't count", () => {
    const texts = facts.map((f) => f.text);
    expect(texts).toContain("What Turbo AI does: An AI note-taker for students.");
    expect(texts).toContain("Turbo AI lists an open role: Software Engineering Intern (Remote)");
    expect(texts).toContain("Rudy Arora is from Frisco, Texas");
    // Rudy's school is "shared" or "conflicting", so it isn't usable.
    expect(texts).not.toContain("Rudy Arora went to Duke University");
    expect(texts).toContain("I go to Duke University");
  });

  it("offers hooks in order of strength, only when a fact supports them", () => {
    expect(availableHooks(facts)).toEqual(["alumni", "hometown", "role", "product"]);
    expect(availableHooks(draftFacts({ ...input, contact: null, company: { ...input.company, score_reasons: [] } }))).toEqual([
      "role",
      "product",
    ]);
  });
});

describe("checkDraft", () => {
  it("passes a short, specific draft", () => {
    expect(checkDraft(good, facts, "F2")).toEqual([]);
  });

  it("catches a draft that's 120 words or more", () => {
    const long = { ...good, body: Array.from({ length: 120 }, () => "word").join(" ") };
    expect(checkDraft(long, facts, "F2")[0]).toMatch(/120 words/);
    expect(wordCount("Hi Rudy,\n\nThanks — really.")).toBe(4);
  });

  it("catches stock phrases, placeholders and made-up numbers", () => {
    const bad = { subject: "Hi", body: "Hi Rudy, I hope this finds you well. I'm passionate about [topic]. Turbo AI has 5 million users!" };
    const problems = checkDraft(bad, facts, "F1").join(" ");
    expect(problems).toMatch(/hope this finds you well/);
    expect(problems).toMatch(/passionate about/);
    expect(problems).toMatch(/placeholder/);
    expect(problems).toMatch(/numbers not in the facts: 5/);
  });

  it("needs a real company fact, not a profile fact", () => {
    const meFact = facts.find((f) => f.kind === "me")!.id;
    expect(checkDraft(good, facts, meFact).join(" ")).toMatch(/company fact/);
    expect(checkDraft(good, facts, "F99").join(" ")).toMatch(/company fact/);
  });
});

describe("checkDraft, review cases", () => {
  it("compares numbers as whole tokens, so 20 isn't found inside 2027", () => {
    const withYear = draftFacts({
      ...input,
      company: { ...input.company, open_roles: [{ title: "Software Engineering Intern (Summer 2027)", source_url: "https://turbo.ai/careers" }] },
    });
    const roleFact = withYear.find((f) => f.hook === "role")!.id;
    expect(checkDraft({ ...good, body: "Hi Rudy, your team of 20 engineers is growing. Best," }, withYear, roleFact).join(" ")).toMatch(
      /numbers not in the facts: 20/,
    );
    expect(checkDraft({ ...good, body: "Hi Rudy, I saw the Summer 2027 role. Best," }, withYear, roleFact)).toEqual([]);
  });

  it("allows a duration range with an en dash, and flags spelled-out amounts", () => {
    expect(checkDraft({ ...good, body: "Hi Rudy, could we talk for 15–20 minutes about the intern role? Best," }, facts, "F2")).toEqual([]);
    expect(checkDraft({ ...good, body: "Hi Rudy, millions of students use it. Best," }, facts, "F2").join(" ")).toMatch(/amounts/);
  });

  it("rejects links and email addresses in a draft", () => {
    expect(checkDraft({ ...good, body: "Hi Rudy, apply at https://evil.example/apply. Best," }, facts, "F2").join(" ")).toMatch(/link/);
    expect(checkDraft({ ...good, body: "Hi Rudy, write to me@example.com. Best," }, facts, "F2").join(" ")).toMatch(/email address/);
  });

  it("doesn't accept the recipient line as the company fact", () => {
    const recipient = facts.find((f) => f.kind === "recipient")!.id;
    expect(checkDraft(good, facts, recipient).join(" ")).toMatch(/company fact/);
  });
});

describe("gmailComposeUrl", () => {
  it("opens a filled compose window and never sends", () => {
    const url = new URL(gmailComposeUrl({ to: "rudy@example.com", ...good }));
    expect(url.origin).toBe("https://mail.google.com");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("to")).toBe("rudy@example.com");
    expect(url.searchParams.get("su")).toBe(good.subject);
    expect(url.searchParams.get("body")).toBe(good.body);
    expect(new URL(gmailComposeUrl({ subject: "s", body: "b" })).searchParams.has("to")).toBe(false);
    // Spaces are %20, not "+".
    expect(gmailComposeUrl({ subject: "a b", body: "c d" })).toContain("su=a%20b");
  });
});
