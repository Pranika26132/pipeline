import { describe, expect, it } from "vitest";

import { signOff } from "./draft-writer";

describe("signOff", () => {
  it("always ends with Best, and the student's name", () => {
    expect(signOff("Hi Rudy,\n\nQuick question.\n\nBest,", "Pranika Kumar")).toBe("Hi Rudy,\n\nQuick question.\n\nBest,\nPranika Kumar");
    expect(signOff("Hi Rudy,\n\nQuick question.\n\nBest,\nPranika Kumar", "Pranika Kumar")).toBe(
      "Hi Rudy,\n\nQuick question.\n\nBest,\nPranika Kumar",
    );
    expect(signOff("Hi Rudy,\n\nQuick question.\n\nThanks!\n\n", "Pranika Kumar")).toBe("Hi Rudy,\n\nQuick question.\n\nBest,\nPranika Kumar");
    expect(signOff("Hi Rudy,\n\nQuick question.", "Pranika Kumar")).toBe("Hi Rudy,\n\nQuick question.\n\nBest,\nPranika Kumar");
  });

  it("keeps a closing sentence that isn't a sign-off", () => {
    expect(signOff("Hi Rudy,\n\nThanks for your time.\n\nBest,", "Pranika")).toBe("Hi Rudy,\n\nThanks for your time.\n\nBest,\nPranika");
  });
});
