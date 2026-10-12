import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { reportReasonLabels } from "../../src/modules/safety/contracts";
import { ReportSheet } from "../../src/modules/safety/components/ReportSheet";

type SheetProps = Parameters<typeof ReportSheet>[0];

/**
 * W1's way out (round 37 #58k): under the intimate-image reason, once it
 * is picked, a link to `/takedown` for a runner who would rather not
 * report from their account. Rendered in a router, as W1 always is.
 */
async function renderSheet() {
  const sheet = (
    <ReportSheet
      open
      onClose={vi.fn()}
      subject={{
        type: "entry",
        id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        label: "mark_t · yesterday",
        authorName: "mark_t",
      }}
      canBlock
      fileReport={vi.fn<SheetProps["fileReport"]>()}
      onFiled={vi.fn()}
    />
  );
  const router = createRouter({
    routeTree: createRootRoute({ component: () => sheet }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

const wayOut = () => document.querySelector("[data-part='takedown-way-out']");

describe("W1's way out to /takedown", () => {
  it("shows only once the intimate-image reason is picked", async () => {
    await renderSheet();
    const user = userEvent.setup();
    expect(wayOut()).toBeNull();

    await user.click(
      screen.getByRole("radio", { name: reportReasonLabels.harassment }),
    );
    expect(wayOut()).toBeNull();

    await user.click(
      screen.getByRole("radio", { name: reportReasonLabels.intimate }),
    );
    expect(wayOut()).toHaveTextContent(
      /^Rather not use your account\? Report it without signing in$/u,
    );
    expect(
      screen.getByRole("link", { name: "Report it without signing in" }),
    ).toHaveAttribute("href", "/takedown");
  });
});
