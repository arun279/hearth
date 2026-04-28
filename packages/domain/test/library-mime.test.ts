import { describe, expect, it } from "vitest";
import { ALLOWED_LIBRARY_MIME_TYPES, isAllowedLibraryMime } from "../src/library/mime.ts";

describe("isAllowedLibraryMime", () => {
  it("accepts every MIME on the allowlist", () => {
    for (const mime of ALLOWED_LIBRARY_MIME_TYPES) {
      expect(isAllowedLibraryMime(mime)).toBe(true);
    }
  });

  it("rejects unknown MIMEs", () => {
    expect(isAllowedLibraryMime("application/x-msdownload")).toBe(false);
    expect(isAllowedLibraryMime("application/zip")).toBe(false);
    expect(isAllowedLibraryMime("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isAllowedLibraryMime("APPLICATION/PDF")).toBe(true);
    expect(isAllowedLibraryMime("Image/PNG")).toBe(true);
  });
});
