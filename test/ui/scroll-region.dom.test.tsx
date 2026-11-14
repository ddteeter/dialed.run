import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { ScrollRegion } from "../../src/ui/ScrollRegion";

/**
 * A scrolling row as a labelled region a keyboard can reach
 * (owner, 2026-11-14, #659).
 */
describe("ScrollRegion", () => {
  it("is a named region that takes focus, with what it scrolls inside", () => {
    render(
      <ScrollRegion label="Photos" part="strip" className="overflow-x-auto">
        <ul>
          <li>one</li>
        </ul>
      </ScrollRegion>,
    );
    const region = screen.getByRole("region", { name: "Photos" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("data-part", "strip");
    expect(region).toContainElement(screen.getByRole("list"));
    region.focus();
    expect(region).toHaveFocus();
  });

  it("draws the contract's ring inside its edge, beside the owner's classes", () => {
    render(
      <ScrollRegion label="Photos" part="strip" className="overflow-x-auto">
        <p>one</p>
      </ScrollRegion>,
    );
    expect(screen.getByRole("region")).toHaveClass(
      "overflow-x-auto",
      "focus-visible:outline",
      "focus-visible:outline-2",
      "focus-visible:-outline-offset-2",
      "focus-visible:outline-ink",
    );
  });

  it("hands its element and its scroll to the owner", () => {
    const ref = createRef<HTMLDivElement>();
    const onScroll = vi.fn();
    render(
      <ScrollRegion
        label="Photos"
        part="strip"
        className=""
        ref={ref}
        onScroll={onScroll}
      >
        <p>one</p>
      </ScrollRegion>,
    );
    const region = screen.getByRole("region");
    expect(ref.current).toBe(region);
    fireEvent.scroll(region);
    expect(onScroll).toHaveBeenCalledOnce();
  });
});
