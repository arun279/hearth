import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderPrimitive } from "../src/test/render.tsx";

/**
 * Guards the primitive harness: happy-dom mounting + userEvent interaction for
 * `@hearth/ui` interaction tests (focus traps, popovers, radio groups).
 */

function Toggle() {
  const [on, setOn] = useState(false);
  return (
    <button type="button" aria-pressed={on} onClick={() => setOn((v) => !v)}>
      {on ? "on" : "off"}
    </button>
  );
}

describe("renderPrimitive", () => {
  it("mounts in a DOM and drives user events", async () => {
    const { user } = renderPrimitive(<Toggle />);
    const button = screen.getByRole("button", { name: "off" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(screen.getByRole("button", { name: "on" })).toHaveAttribute("aria-pressed", "true");
  });
});
