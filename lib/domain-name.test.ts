import { describe, expect, it } from "vitest";

import { displayName, nameFromDomain } from "./domain";

describe("nameFromDomain", () => {
  it.each([
    ["oxide.computer", "Oxide"],
    ["turbo.ai", "Turbo AI"],
    ["restor3d.com", "Restor3d"],
    ["acme-labs.com", "Acme Labs"],
    ["www.stripe.com", "Stripe"],
    ["app.example.co", "Example"],
  ])("%s → %s", (domain, name) => {
    expect(nameFromDomain(domain)).toBe(name);
  });

  it("keeps a real saved name, and replaces one that's just the website", () => {
    expect(displayName("Oxide Computer Company", "oxide.computer")).toBe("Oxide Computer Company");
    expect(displayName("oxide.computer", "oxide.computer")).toBe("Oxide");
    expect(displayName("turbo.ai", "turbo.ai")).toBe("Turbo AI");
  });
});
