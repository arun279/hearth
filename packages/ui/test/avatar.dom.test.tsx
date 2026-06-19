import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "../src/avatar.tsx";
import { renderPrimitive } from "../src/test/render.tsx";

/**
 * Avatar's only stateful branch is the `img.onError` → `setImgBroken(true)`
 * transition that swaps a broken image for the initials fallback tile. The hue
 * helper, initials extraction, and the static src-null rendering are pure /
 * static and belong at the unit / SSR-string altitude — this DOM test pins the
 * runtime error→fallback transition only.
 */

describe("Avatar", () => {
  it("falls back to the initials tile when the image fails to load", () => {
    const { container } = renderPrimitive(
      <Avatar name="Ada Lovelace" src="https://example.test/broken.png" />,
    );

    // The avatar img is decorative (`alt=""`), so it has no accessible role;
    // query it directly rather than by role.
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(screen.queryByText("AL")).not.toBeInTheDocument();

    fireEvent.error(img as HTMLImageElement);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});
