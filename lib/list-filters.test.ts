import { describe, expect, it } from "vitest";

import { filtersHref, matchesFilters, parseFilters, toggleFactor } from "./list-filters";

describe("list filters", () => {
  it("reads chips from the URL and ignores unknown values", () => {
    expect(parseFilters({ f: ["alumni", "nonsense"], status: "bogus", contacted: "1" })).toEqual({
      factors: ["school"],
      status: null,
      showContacted: true,
    });
  });

  it("round-trips through a link", () => {
    const filters = parseFilters({ f: ["role", "alumni"], status: "sent" });
    expect(filtersHref(filters)).toBe("/?f=alumni&f=role&status=sent");
    expect(filtersHref(toggleFactor(toggleFactor(filters, "school"), "open_role"))).toBe("/?status=sent");
    expect(filtersHref(parseFilters({}))).toBe("/");
  });

  it("hides contacted companies by default", () => {
    const none = parseFilters({});
    expect(matchesFilters({ factors: [], status: "to_contact" }, none)).toBe(true);
    expect(matchesFilters({ factors: [], status: "drafted" }, none)).toBe(true);
    expect(matchesFilters({ factors: [], status: "sent" }, none)).toBe(false);
    expect(matchesFilters({ factors: [], status: "ghosted" }, parseFilters({ contacted: "1" }))).toBe(true);
  });

  it("a status chip shows that status even when contacted ones are hidden", () => {
    expect(matchesFilters({ factors: [], status: "replied" }, parseFilters({ status: "replied" }))).toBe(true);
    expect(matchesFilters({ factors: [], status: "sent" }, parseFilters({ status: "replied" }))).toBe(false);
  });

  it("needs every chosen factor to have counted", () => {
    const both = parseFilters({ f: ["alumni", "hometown"] });
    expect(matchesFilters({ factors: ["school", "hometown", "open_role"], status: "to_contact" }, both)).toBe(true);
    expect(matchesFilters({ factors: ["school"], status: "to_contact" }, both)).toBe(false);
  });
});
