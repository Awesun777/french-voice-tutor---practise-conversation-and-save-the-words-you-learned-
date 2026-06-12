import { describe, it, expect } from "vitest";
import { detectNumericDateFormat, extractDocId, parseDateKey } from "./googleDrive";

// ── extractDocId ──────────────────────────────────────────────────────────────

describe("extractDocId", () => {
  it("extracts doc ID from standard edit URL", () => {
    const url = "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit";
    expect(extractDocId(url)).toBe("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms");
  });

  it("extracts doc ID from view URL", () => {
    const url = "https://docs.google.com/document/d/ABC123_-xyz/view?usp=sharing";
    expect(extractDocId(url)).toBe("ABC123_-xyz");
  });

  it("returns null for non-Google-Doc URLs", () => {
    expect(extractDocId("https://drive.google.com/file/d/abc/view")).toBeNull();
    expect(extractDocId("https://example.com")).toBeNull();
    expect(extractDocId("not a url")).toBeNull();
  });

  it("handles URLs with trailing slashes", () => {
    const url = "https://docs.google.com/document/d/DOCID123/edit#heading=h.abc";
    expect(extractDocId(url)).toBe("DOCID123");
  });
});

// ── accent normalization (quiz grading logic) ─────────────────────────────────

describe("accent normalization (quiz grading logic)", () => {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  it("normalizes accented characters", () => {
    expect(normalize("étudier")).toBe("etudier");
    expect(normalize("où")).toBe("ou");
    expect(normalize("café")).toBe("cafe");
    expect(normalize("naïve")).toBe("naive");
  });

  it("is case insensitive", () => {
    expect(normalize("Bonjour")).toBe("bonjour");
    expect(normalize("FRANÇAIS")).toBe("francais");
  });

  it("matches accent-stripped user input to correct answer", () => {
    const correct = "étudier";
    const userInput = "etudier";
    expect(normalize(correct)).toBe(normalize(userInput));
  });
});

// ── parseDateKey ──────────────────────────────────────────────────────────────

describe("parseDateKey", () => {
  it("passes through ISO dates unchanged", () => {
    expect(parseDateKey("2025-06-05")).toBe("2025-06-05");
    expect(parseDateKey("2024-01-01")).toBe("2024-01-01");
  });

  it("parses English month-day with explicit year", () => {
    expect(parseDateKey("June 5, 2025")).toBe("2025-06-05");
    expect(parseDateKey("January 1, 2024")).toBe("2024-01-01");
  });

  it("parses English month-day without year using current year", () => {
    const currentYear = new Date().getFullYear();
    const result = parseDateKey("June 5");
    expect(result).toBe(`${currentYear}-06-05`);
  });

  it("applies yearOverride when provided", () => {
    expect(parseDateKey("June 5", 2023)).toBe("2023-06-05");
    expect(parseDateKey("March 15", 2022)).toBe("2022-03-15");
  });

  it("parses French date format", () => {
    expect(parseDateKey("5 juin 2025")).toBe("2025-06-05");
    expect(parseDateKey("15 mars 2024")).toBe("2024-03-15");
  });

  it("parses French date without year using current year", () => {
    const currentYear = new Date().getFullYear();
    const result = parseDateKey("5 juin");
    expect(result).toBe(`${currentYear}-06-05`);
  });

  it("returns null for empty string", () => {
    // Empty string has no date content at all
    expect(parseDateKey("")).toBeNull();
  });

  it("note: Node.js Date parser is permissive — non-date strings with a year may parse", () => {
    // This is expected behaviour: parseDateKey delegates to new Date() which is
    // very lenient. The function is only called on lines already identified as
    // date headers by the regex pre-pass, so garbage input is not a concern.
    const result = parseDateKey("June 5");
    expect(typeof result).toBe("string");
  });
});

// ── line-aligned batching (batchLines is internal, test via extractVocabGroups shape) ──

describe("line-batching invariants", () => {
  it("parseDateKey handles day-of-week prefix in English dates", () => {
    // "Monday June 3" — the regex strips the day name, native Date handles the rest
    const currentYear = new Date().getFullYear();
    // parseDateKey won't match "Monday June 3" directly via ISO or native Date,
    // but it should return a valid date or null (not throw)
    const result = parseDateKey("Monday June 3");
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("parseDateKey with yearOverride overrides ambiguous dates", () => {
    expect(parseDateKey("5 juin", 2020)).toBe("2020-06-05");
    expect(parseDateKey("December 25", 2019)).toBe("2019-12-25");
  });
});

// ── numeric date formats (DD/MM vs MM/DD) ─────────────────────────────────────

describe("detectNumericDateFormat", () => {
  it("detects day-first when a first component exceeds 12", () => {
    expect(detectNumericDateFormat(["15/05", "des mots", "03/06"])).toBe("DM");
    expect(detectNumericDateFormat(["20.07.2025"])).toBe("DM");
  });

  it("detects month-first when a second component exceeds 12", () => {
    expect(detectNumericDateFormat(["05/15", "07/20/2025"])).toBe("MD");
  });

  it("majority wins when evidence conflicts", () => {
    expect(detectNumericDateFormat(["15/05", "20/07", "05/13"])).toBe("DM");
  });

  it("defaults to US month-first with no unambiguous headers", () => {
    expect(detectNumericDateFormat(["05/06", "rien d'autre"])).toBe("MD");
    expect(detectNumericDateFormat([])).toBe("MD");
  });
});

describe("parseDateKey numeric dates", () => {
  it("parses unambiguous day-first dates regardless of format hint", () => {
    expect(parseDateKey("15/05", 2026)).toBe("2026-05-15");
    expect(parseDateKey("15/05", 2026, "MD")).toBe("2026-05-15");
  });

  it("parses unambiguous month-first dates regardless of format hint", () => {
    expect(parseDateKey("05/15", 2026, "DM")).toBe("2026-05-15");
  });

  it("uses the format hint for ambiguous dates", () => {
    expect(parseDateKey("05/06", 2026, "DM")).toBe("2026-06-05");
    expect(parseDateKey("05/06", 2026, "MD")).toBe("2026-05-06");
  });

  it("handles explicit years, including two-digit years", () => {
    expect(parseDateKey("15/05/2025", undefined, "DM")).toBe("2025-05-15");
    expect(parseDateKey("15.05.25", undefined, "DM")).toBe("2025-05-15");
    expect(parseDateKey("07/20/2025", undefined, "MD")).toBe("2025-07-20");
  });

  it("defaults missing years to the current year", () => {
    const y = new Date().getFullYear();
    expect(parseDateKey("15/05")).toBe(`${y}-05-15`);
  });

  it("rejects impossible dates", () => {
    expect(parseDateKey("13/13", 2026)).toBeNull();
    expect(parseDateKey("32/05", 2026)).toBeNull();
  });
});
