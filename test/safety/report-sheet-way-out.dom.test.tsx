import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const fileReport = vi.fn<SheetProps["fileReport"]>().mockResolvedValue({
    status: "filed",
    reporterCount: 1,
    hiddenPendingReview: true,
  });
  const onClose = vi.fn();
  const onFiled = vi.fn();
  const sheet = (
    <ReportSheet
      open
      onClose={onClose}
      subject={{
        type: "entry",
        id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        label: "mark_t · yesterday",
        authorName: "mark_t",
      }}
      canBlock
      fileReport={fileReport}
      onFiled={onFiled}
    />
  );
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <main>
          <h1>mark_t · yesterday</h1>
          {sheet}
        </main>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return { fileReport, onClose, onFiled };
}

const wayOut = () => document.querySelector("[data-part='takedown-way-out']");
const elsewhere = () => document.querySelector("[data-part='elsewhere-help']");

describe("W1's way out to /takedown", () => {
  it("shows only once the intimate-image reason is picked", async () => {
    await renderSheet();
    const user = userEvent.setup();
    expect(wayOut()).toBeNull();
    expect(elsewhere()).toBeNull();

    await user.click(
      screen.getByRole("radio", { name: reportReasonLabels.harassment }),
    );
    expect(wayOut()).toBeNull();
    expect(elsewhere()).toBeNull();

    await user.click(
      screen.getByRole("radio", { name: reportReasonLabels.intimate }),
    );
    expect(wayOut()).toHaveTextContent(
      /^Rather not use your account\? Report it without signing in$/u,
    );
    expect(
      screen.getByRole("link", { name: "Report it without signing in" }),
    ).toHaveAttribute("href", "/takedown");
    // Where else to go waits for the receipt (round 41 #85).
    expect(elsewhere()).toBeNull();
  });
});

async function sent(reason: keyof typeof reportReasonLabels) {
  const spies = await renderSheet();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("radio", { name: reportReasonLabels[reason] }),
  );
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(() => {
    expect(spies.fileReport).toHaveBeenCalled();
  });
  return { ...spies, user };
}

/**
 * Round 42: an intimate-image report swaps the sheet for a receipt that
 * says what we owe and where else to go; every other reason closes it.
 */
describe("W1's intimate-image receipt", () => {
  it("swaps in place, with the head focused and the other sites last", async () => {
    const { onClose, onFiled } = await sent("intimate");

    const head = await screen.findByRole("heading", {
      name: "Thanks for telling us.",
    });
    await waitFor(() => {
      expect(head).toHaveFocus();
    });
    const receipt = document.querySelector("[data-part='report-receipt']");
    expect(receipt).toHaveTextContent(
      /^Report sentThanks for telling us\.It's hidden from everyone now\. We'll review it within a day and keep it down if it breaks the rule\.If it's on other sites too.*leaves it\.Done$/u,
    );
    expect(receipt?.lastElementChild?.previousElementSibling).toBe(elsewhere());
    expect(screen.queryByRole("button", { name: "Send report" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Report sent" })).toBeVisible();
    // Still open: nothing has closed it yet.
    expect(onClose).not.toHaveBeenCalled();
    expect(onFiled).not.toHaveBeenCalled();
  });

  it("closes on Done, and hands focus to the page heading", async () => {
    const { onClose, onFiled, user } = await sent("intimate");

    await user.click(await screen.findByRole("button", { name: "Done" }));

    expect(onFiled).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "mark_t · yesterday",
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("closes on Esc the same way", async () => {
    const { onClose, onFiled } = await sent("intimate");
    await screen.findByRole("heading", { name: "Thanks for telling us." });

    fireEvent(screen.getByRole("dialog"), new Event("close"));

    expect(onFiled).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    });
  });

  it("is for intimate-image reports only: any other closes on its status", async () => {
    const { onClose, onFiled } = await sent("harassment");

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(onFiled).toHaveBeenCalledOnce();
    expect(screen.getByText("Report sent.")).toBeInTheDocument();
    expect(document.querySelector("[data-part='report-receipt']")).toBeNull();
  });
});
