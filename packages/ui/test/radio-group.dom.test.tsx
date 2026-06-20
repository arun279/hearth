import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RadioGroup } from "../src/radio-group.tsx";
import { renderPrimitive } from "../src/test/render.tsx";

/**
 * RadioGroup is a controlled native-radio fieldset (no internal state). Its
 * tone/adornment/legend props are pure prop→markup mappings already covered at
 * the SSR-string altitude; the only branch needing a mounted DOM is the
 * controlled round-trip: a click fires `onValueChange`, the `checked` mirror
 * follows the value prop, and a disabled fieldset suppresses the callback.
 */

const OPTIONS = [
  { value: "a" as const, label: "Option A" },
  { value: "b" as const, label: "Option B" },
];

function Controlled({ onChange }: { onChange?: (v: "a" | "b") => void }) {
  const [value, setValue] = useState<"a" | "b" | null>(null);
  return (
    <RadioGroup
      legend="Pick one"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      options={OPTIONS}
    />
  );
}

describe("RadioGroup", () => {
  it("fires onValueChange with the clicked option's value and reflects it as checked", async () => {
    const onChange = vi.fn();
    const { user } = renderPrimitive(<Controlled onChange={onChange} />);

    const a = screen.getByRole("radio", { name: "Option A" });
    const b = screen.getByRole("radio", { name: "Option B" });
    expect(a).not.toBeChecked();
    expect(b).not.toBeChecked();

    await user.click(a);
    expect(onChange).toHaveBeenLastCalledWith("a");
    expect(a).toBeChecked();
    expect(b).not.toBeChecked();

    await user.click(b);
    expect(onChange).toHaveBeenLastCalledWith("b");
    expect(b).toBeChecked();
    expect(a).not.toBeChecked();
  });

  it("mirrors an externally-driven value change in which radio is checked", () => {
    const { rerender } = renderPrimitive(
      <RadioGroup legend="Pick one" value="a" onValueChange={() => {}} options={OPTIONS} />,
    );
    expect(screen.getByRole("radio", { name: "Option A" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Option B" })).not.toBeChecked();

    rerender(<RadioGroup legend="Pick one" value="b" onValueChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Option B" })).toBeChecked();
  });

  it("suppresses the callback when the fieldset is disabled", async () => {
    const onChange = vi.fn();
    const { user } = renderPrimitive(
      <RadioGroup
        legend="Pick one"
        value={null}
        onValueChange={onChange}
        options={OPTIONS}
        disabled
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Option A" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeChecked();
  });
});
