import { describe, expect, it } from "vitest";

import { availableHooks, checkDraft, draftFacts, gmailComposeUrl, wordCount, type DraftInput } from "./drafts";
import { fitKey } from "./fit";

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
  today: new Date("2026-10-18T12:00:00Z"),
};
const facts = draftFacts(input);
const good = {
  subject: "Duke student interested in a software internship",
  body: "Hi Rudy,\n\nI'm a Duke student looking for a software engineering internship, and I saw Turbo AI lists a Software Engineering Intern role. Would you have 15 minutes this month to tell me what the team looks for?\n\nBest,",
};

describe("draftFacts", () => {
  it("lists company, person and profile facts, and leaves out a person fact that doesn't count", () => {
    const texts = facts.map((f) => f.text);
    expect(texts).toContain("What Turbo AI builds: An AI note-taker for students.");
    expect(texts).toContain("Turbo AI lists an open role: Software Engineering Intern (Remote)");
    expect(texts).toContain("Rudy Arora is from Frisco, Texas");
    // Rudy's school is "shared" or "conflicting", so it isn't usable.
    expect(texts).not.toContain("Rudy Arora went to Duke University");
    expect(texts).toContain("I go to Duke University");
  });

  it("offers hooks in order of strength, only when a fact supports them", () => {
    expect(availableHooks(facts)).toEqual(["product", "role", "alumni", "hometown"]);
    expect(availableHooks(draftFacts({ ...input, contact: null, company: { ...input.company, score_reasons: [] } })))
      .toEqual(["product", "role"]);
  });
});

describe("checkDraft", () => {
  it("passes a short, specific draft", () => {
    expect(checkDraft(good, facts, { company: "F2" })).toEqual([]);
  });

  it("catches a draft that's 120 words or more", () => {
    const long = { ...good, body: Array.from({ length: 120 }, () => "word").join(" ") };
    expect(checkDraft(long, facts, { company: "F2" })[0]).toMatch(/120 words/);
    expect(wordCount("Hi Rudy,\n\nThanks — really.")).toBe(4);
  });

  it("catches stock phrases, placeholders and made-up numbers", () => {
    const bad = { subject: "Hi", body: "Hi Rudy, I hope this finds you well. I'm passionate about [topic]. Turbo AI has 5 million users!" };
    const problems = checkDraft(bad, facts, { company: "F1" }).join(" ");
    expect(problems).toMatch(/hope this finds you well/);
    expect(problems).toMatch(/passionate about/);
    expect(problems).toMatch(/placeholder/);
    expect(problems).toMatch(/numbers not in the facts: 5/);
  });

  it("needs a real company fact, not a profile fact", () => {
    const meFact = facts.find((f) => f.kind === "me")!.id;
    expect(checkDraft(good, facts, { company: meFact }).join(" ")).toMatch(/company fact/);
    expect(checkDraft(good, facts, { company: "F99" }).join(" ")).toMatch(/company fact/);
  });
});

describe("checkDraft, review cases", () => {
  it("compares numbers as whole tokens, so 20 isn't found inside 2027", () => {
    const withYear = draftFacts({
      ...input,
      company: { ...input.company, open_roles: [{ title: "Software Engineering Intern (Summer 2027)", source_url: "https://turbo.ai/careers" }] },
    });
    const roleFact = withYear.find((f) => f.hook === "role")!.id;
    expect(checkDraft({ ...good, body: "Hi Rudy, your team of 20 engineers is growing. Best," }, withYear, { company: roleFact }).join(" ")).toMatch(
      /numbers not in the facts: 20/,
    );
    expect(checkDraft({ ...good, body: "Hi Rudy, I saw the Summer 2027 role. Best," }, withYear, { company: roleFact })).toEqual([]);
  });

  it("allows a duration range with an en dash, and flags spelled-out amounts", () => {
    expect(checkDraft({ ...good, body: "Hi Rudy, could we talk for 15–20 minutes about the intern role? Best," }, facts, { company: "F2" })).toEqual([]);
    expect(checkDraft({ ...good, body: "Hi Rudy, millions of students use it. Best," }, facts, { company: "F2" }).join(" ")).toMatch(/amounts/);
  });

  it("rejects links and email addresses in a draft", () => {
    expect(checkDraft({ ...good, body: "Hi Rudy, apply at https://evil.example/apply. Best," }, facts, { company: "F2" }).join(" ")).toMatch(/link/);
    expect(checkDraft({ ...good, body: "Hi Rudy, write to me@example.com. Best," }, facts, { company: "F2" }).join(" ")).toMatch(/email address/);
  });

  it("doesn't accept the recipient line as the company fact", () => {
    const recipient = facts.find((f) => f.kind === "recipient")!.id;
    expect(checkDraft(good, facts, { company: recipient }).join(" ")).toMatch(/company fact/);
  });
});

describe("past roles, connections and the student's lines", () => {
  it("never offers a past-dated role as open", () => {
    const past = draftFacts({
      ...input,
      company: { ...input.company, open_roles: [{ title: "Summer 2026 SWE Intern", source_url: "https://turbo.ai/careers" }] },
    });
    const role = past.find((f) => f.hook === "role")!;
    expect(role.text).toMatch(/dates have passed/);
    expect(role.text).toMatch(/upcoming internships/);
  });

  it("doesn't pass the interests list, and limits target roles to one", () => {
    const texts = facts.map((f) => f.text).join(" ");
    expect(texts).not.toMatch(/interests/i);
    expect(texts).toMatch(/name at most one/);
  });

  it("accepts one connection fact, but not a company fact in that place", () => {
    const connection = facts.find((f) => f.kind === "connection")!.id;
    expect(checkDraft(good, facts, { company: "F2", connection })).toEqual([]);
    expect(checkDraft(good, facts, { company: "F2", connection: "F1" }).join(" ")).toMatch(/connection/);
  });

  it("allows a detail and number the student wrote in a sample", () => {
    const body = "Hi Rudy, I built a parser that handled 40 file types. Could we talk for 15 minutes? Best,";
    expect(checkDraft({ ...good, body }, facts, { company: "F1" }).join(" ")).toMatch(/40/);
    expect(checkDraft({ ...good, body }, facts, { company: "F1" }, "I built a parser that handled 40 file types.")).toEqual([]);
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

describe("About me and role fit in drafts", () => {
  const profile = { ...input.profile!, degree: "BS", major: "Computer Science", grad_year: 2028, resume: "Built a 3D printer slicer in Rust used by 40 students." };

  it("adds the student's study and resume as their own facts", () => {
    const me = draftFacts({ ...input, profile }).filter((f) => f.kind === "me").map((f) => f.text);
    expect(me).toContain("I'm studying BS in Computer Science, class of 2028");
    expect(me.some((t) => t.startsWith("My resume") && t.includes("Rust"))).toBe(true);
  });

  it("allows numbers from the resume in a draft", () => {
    const f = draftFacts({ ...input, profile });
    const draft = { subject: "Rust and note-taking", body: "Hi Rudy,\n\nI built a slicer in Rust that 40 students use. Would you have 15 minutes?\n\nBest," };
    expect(checkDraft(draft, f, { company: f.find((x) => x.kind === "company")!.id })).toEqual([]);
  });

  it("leaves out a role Claude judged not to fit", () => {
    const role_fit = {
      key: fitKey(profile),
      checked_at: "x",
      roles: [{ title: "Software Engineering Intern", source_url: "https://turbo.ai/careers", verdict: "no_fit", reason: "PhD only." }],
    };
    const f = draftFacts({ ...input, profile, company: { ...input.company, role_fit } });
    expect(f.some((x) => x.hook === "role")).toBe(false);
    // Stale verdicts (profile changed) don't hide it.
    const stale = draftFacts({ ...input, profile: { ...profile, major: "Math" }, company: { ...input.company, role_fit } });
    expect(stale.some((x) => x.hook === "role")).toBe(true);
  });
});
