import { describe, expect, it } from "vitest";

import { checkUpload, cleanResumeText, RESUME_MAX_BYTES } from "./resume";

const PDF = new TextEncoder().encode("%PDF-1.7\n");

describe("checkUpload", () => {
  it("accepts a PDF within the limit", () => {
    expect(checkUpload({ name: "resume.pdf", type: "application/pdf", size: 1000 }, PDF)).toBeNull();
    // Some browsers send no type; the name and the bytes decide.
    expect(checkUpload({ name: "resume.PDF", type: "", size: 1000 }, PDF)).toBeNull();
  });
  it("says what's wrong: type, size, empty, fake PDF", () => {
    expect(checkUpload({ name: "resume.docx", type: "application/msword", size: 1000 }, PDF)).toMatch(/isn't a PDF/);
    expect(checkUpload({ name: "r.pdf", type: "application/pdf", size: RESUME_MAX_BYTES + 1 }, PDF)).toMatch(/limit is 4 MB/);
    expect(checkUpload({ name: "r.pdf", type: "application/pdf", size: 0 }, PDF)).toMatch(/empty/);
    expect(checkUpload({ name: "r.pdf", type: "application/pdf", size: 10 }, new TextEncoder().encode("PK\x03\x04"))).toMatch(/isn't a real PDF/);
  });
});

describe("cleanResumeText", () => {
  it("drops code fences and extra blank lines", () => {
    expect(cleanResumeText("```text\nJane Doe\n\n\n\n- Built a compiler   \n```")).toBe("Jane Doe\n\n- Built a compiler");
  });
});
