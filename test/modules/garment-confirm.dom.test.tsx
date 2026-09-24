import { render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { GarmentConfirm } from "../../src/modules/closet/components/GarmentConfirm";
import type { ControlAction } from "../../src/ui";

/**
 * The confirm sheet on its own: the two mountings garment detail never
 * produces, and which the focus rule still has to survive.
 */
function ignore(): void {
  // Nothing under test reacts to this.
}

function idle(): ControlAction<["retire" | "delete"]> {
  return {
    pending: false,
    failure: undefined,
    status: "",
    run: () => Promise.resolve(),
    retry: ignore,
    retryRef: createRef(),
  };
}

describe("GarmentConfirm: where focus lands", () => {
  it("lands on Keep it when the sheet mounts already open", async () => {
    // The first pass of the focus effect runs before the button has been
    // handed over, so it has to wait for it rather than reach for nothing.
    render(
      <GarmentConfirm
        kind="retire"
        name="Harrier"
        runCount={0}
        action={idle()}
        onClose={ignore}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    });
  });

  it("takes no focus while it is closed", () => {
    render(
      <GarmentConfirm
        kind={undefined}
        name="Harrier"
        runCount={0}
        action={idle()}
        onClose={ignore}
      />,
    );

    expect(document.activeElement).toBe(document.body);
  });
});
