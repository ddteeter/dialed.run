import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DeskSignOut,
  DeskSignOutProvider,
} from "../../src/modules/ops/components/DeskSignOut";

/**
 * The Desk's top bar's Sign out (R55·194), seated by the `/desk` layout
 * route through `DeskSignOutProvider`.
 */
describe("DeskSignOut", () => {
  it("draws nothing where no route seated a sign-out", () => {
    const { container } = render(<DeskSignOut />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws what the route seated", () => {
    render(
      <DeskSignOutProvider value={<button type="button">Sign out</button>}>
        <DeskSignOut />
      </DeskSignOutProvider>,
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});
