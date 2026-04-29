import { describe, expect, it } from "vitest";
import { displayKindFor } from "../src/library/kinds.ts";

describe("displayKindFor", () => {
  it("maps PDF to pdf", () => {
    expect(displayKindFor("application/pdf")).toBe("pdf");
  });

  it("maps audio family to audio", () => {
    expect(displayKindFor("audio/mpeg")).toBe("audio");
    expect(displayKindFor("audio/wav")).toBe("audio");
    expect(displayKindFor("audio/anything-future")).toBe("audio");
  });

  it("maps video family to video", () => {
    expect(displayKindFor("video/mp4")).toBe("video");
    expect(displayKindFor("video/webm")).toBe("video");
  });

  it("maps image family to image", () => {
    expect(displayKindFor("image/png")).toBe("image");
    expect(displayKindFor("image/jpeg")).toBe("image");
  });

  it("maps known doc MIMEs to doc", () => {
    expect(displayKindFor("text/markdown")).toBe("doc");
    expect(displayKindFor("text/plain")).toBe("doc");
    expect(displayKindFor("application/msword")).toBe("doc");
    expect(
      displayKindFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("doc");
  });

  it("falls through to other for unknown MIMEs", () => {
    expect(displayKindFor("application/xml")).toBe("other");
    expect(displayKindFor("")).toBe("other");
  });

  it("treats MIME type case-insensitively", () => {
    expect(displayKindFor("APPLICATION/PDF")).toBe("pdf");
    expect(displayKindFor("Audio/MPEG")).toBe("audio");
  });
});
