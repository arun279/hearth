import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabBar, type TabItem } from "../src/tab-bar.tsx";
import { renderPrimitive } from "../src/test/render.tsx";

/**
 * TabBar implements automatic-activation keyboard nav (ArrowLeft/Right wrap,
 * Home/End) over an ARIA tablist, and gates DOM focus-moving on a
 * `moveFocusOnNextChange` ref so keyboard nav refocuses the selected tab while
 * an external (route/click) value change does NOT. The focus-gate distinction
 * is the testing-trophy unit e2e can't economically pin.
 */

const ITEMS: readonly TabItem<string>[] = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
];

function Controlled({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("one");
  return (
    <TabBar
      items={ITEMS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      ariaLabel="Sections"
      idPrefix="sec"
    />
  );
}

describe("TabBar", () => {
  it("navigates and wraps with ArrowRight/ArrowLeft", async () => {
    const onChange = vi.fn();
    const { user } = renderPrimitive(<Controlled onChange={onChange} />);
    screen.getByRole("tab", { name: "One" }).focus();

    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("two");
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("three");
    // Wrap forward past the last tab back to the first.
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("one");
    // Wrap backward from the first to the last.
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("three");
  });

  it("jumps to first with Home and last with End", async () => {
    const onChange = vi.fn();
    const { user } = renderPrimitive(<Controlled onChange={onChange} />);
    screen.getByRole("tab", { name: "One" }).focus();

    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("three");
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("one");
  });

  it("moves DOM focus to the selected tab on keyboard nav and rolls the roving tabindex", async () => {
    const { user } = renderPrimitive(<Controlled />);
    const one = screen.getByRole("tab", { name: "One" });
    one.focus();
    expect(one).toHaveAttribute("tabindex", "0");

    await user.keyboard("{ArrowRight}");
    const two = screen.getByRole("tab", { name: "Two" });
    expect(two).toHaveFocus();
    expect(two).toHaveAttribute("tabindex", "0");
    expect(one).toHaveAttribute("tabindex", "-1");
  });

  it("does NOT move focus when the value changes externally (no keydown)", async () => {
    function ExternalDriver() {
      const [value, setValue] = useState("one");
      return (
        <div>
          <button type="button" onClick={() => setValue("three")}>
            jump external
          </button>
          <TabBar
            items={ITEMS}
            value={value}
            onChange={setValue}
            ariaLabel="Sections"
            idPrefix="sec"
          />
        </div>
      );
    }
    const { user } = renderPrimitive(<ExternalDriver />);
    const external = screen.getByRole("button", { name: "jump external" });
    external.focus();

    await user.click(external);
    const three = screen.getByRole("tab", { name: "Three" });
    expect(three).toHaveAttribute("aria-selected", "true");
    // The selected tab updated, but focus stayed on the external control —
    // route/click-driven changes must not yank the keyboard cursor.
    expect(three).not.toHaveFocus();
    expect(external).toHaveFocus();
  });

  it("calls onChange on click without arming the focus-move", async () => {
    const onChange = vi.fn();
    const { user } = renderPrimitive(<Controlled onChange={onChange} />);
    const two = screen.getByRole("tab", { name: "Two" });

    await user.click(two);
    expect(onChange).toHaveBeenLastCalledWith("two");
    // After a click the newly-active tab carries tabindex 0, but the click
    // path does not call `navigate`, so no programmatic refocus is armed.
    expect(two).toHaveAttribute("aria-selected", "true");
  });
});
