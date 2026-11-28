import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DeletionLinkLanding,
  askBody,
  endCopy,
} from "../../src/modules/account/data/components/DeletionLinkLanding";
import type { DeletionLanding } from "../../src/modules/account/data/deletion-link";

/**
 * The Desk's deletion link's page (round 64 #374.3), signed out: the ask
 * first, so opening it spends nothing, then the page the button answers
 * with, or NOT DELETED.
 */

async function renderPage(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

function status(): HTMLElement {
  const [region] = screen.getAllByRole("status");
  if (region === undefined) throw new Error("no status region");
  return region;
}

const ASK: DeletionLanding = {
  state: "ask",
  handle: "runner_1290",
  day: "Fri, Dec 4",
};

describe("askBody", () => {
  it("names the account by its handle, or as theirs when it has none (owner, 2026-11-27)", () => {
    expect(
      askBody({ state: "ask", handle: "runner_1290", day: "Fri, Dec 4" }),
    ).toBe(
      "@runner_1290 is closed. Deleting it removes your runs, closet, entries and photos on Fri, Dec 4. You can't undo this.",
    );
    expect(
      askBody({ state: "ask", handle: undefined, day: "Fri, Dec 4" }),
    ).toBe(
      "Your account is closed. Deleting it removes your runs, closet, entries and photos on Fri, Dec 4. You can't undo this.",
    );
  });
});

describe("endCopy", () => {
  it("says each end in round 64's words", () => {
    expect(endCopy({ state: "done", day: "Fri, Dec 4" })).toStrictEqual({
      kicker: "Deletion scheduled",
      toneClass: "text-dialed-text",
      heading: "Your account goes on Fri, Dec 4.",
      body: "We've sent an email saying so. There's nothing more to do.",
    });
    expect(endCopy({ state: "used", day: "Fri, Dec 4" })).toStrictEqual({
      kicker: "Deletion scheduled",
      toneClass: "text-dialed-text",
      heading: "This account already goes on Fri, Dec 4.",
      body: "The link was used. There's nothing more to do.",
    });
    expect(endCopy({ state: "expired" })).toStrictEqual({
      kicker: "Link expired",
      toneClass: "text-cold-text",
      heading: "This link doesn't work any more.",
      body: "To ask for a new one, reply to the email it came in.",
    });
  });
});

describe("DeletionLinkLanding", () => {
  it("asks first, spending nothing, with one ink button", async () => {
    const confirm = vi.fn<() => Promise<DeletionLanding>>();
    await renderPage(<DeletionLinkLanding landing={ASK} confirm={confirm} />);

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Delete your account?",
    });
    expect(heading).toBeVisible();
    // No kicker over this ask's heading.
    expect(heading.previousElementSibling).toBeNull();
    expect(screen.getByText(askBody(ASK))).toBeVisible();
    expect(
      screen.getByText(askBody(ASK)).closest("[data-part=landing]"),
    ).toHaveAttribute("data-state", "ask");
    expect(
      screen.getByRole("button", { name: "Delete my account" }),
    ).toHaveClass("bg-ink");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("spends it on the button, and says what it did", async () => {
    const confirm = vi
      .fn<() => Promise<DeletionLanding>>()
      .mockResolvedValue({ state: "done", day: "Fri, Dec 4" });
    const user = userEvent.setup();
    await renderPage(<DeletionLinkLanding landing={ASK} confirm={confirm} />);

    await user.click(screen.getByRole("button", { name: "Delete my account" }));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Your account goes on Fri, Dec 4.",
      }),
    ).toBeVisible();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Deletion scheduled")).toHaveClass(
      "text-dialed-text",
    );
    expect(status()).toHaveTextContent("Your account goes on Fri, Dec 4.");
    expect(
      screen.queryByRole("button", { name: "Delete my account" }),
    ).toBeNull();
  });

  it.each([
    [{ state: "expired" }, "This link doesn't work any more."],
    [
      { state: "used", day: "Fri, Dec 4" },
      "This account already goes on Fri, Dec 4.",
    ],
  ] as const)(
    "lands %o on its end, announcing nothing and spending nothing",
    async (landing, heading) => {
      const confirm = vi.fn<() => Promise<DeletionLanding>>();
      await renderPage(
        <DeletionLinkLanding landing={landing} confirm={confirm} />,
      );
      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
      expect(status().textContent).toBe("");
      expect(
        screen.getByText(endCopy(landing).body).closest("[data-part=landing]"),
      ).toHaveAttribute("data-state", landing.state);
      expect(screen.queryByRole("button")).toBeNull();
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it("says Deleting on the button while the press is in flight", async () => {
    const confirm = vi
      .fn<() => Promise<DeletionLanding>>()
      .mockReturnValue(
        new Promise<DeletionLanding>(() => {
          // Never settles.
        }),
      );
    const user = userEvent.setup();
    await renderPage(<DeletionLinkLanding landing={ASK} confirm={confirm} />);

    await user.click(screen.getByRole("button", { name: "Delete my account" }));

    expect(
      await screen.findByRole("button", { name: "Deleting" }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("says NOT DELETED when the press fails, and keeps the question", async () => {
    const confirm = vi
      .fn<() => Promise<DeletionLanding>>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    await renderPage(<DeletionLinkLanding landing={ASK} confirm={confirm} />);

    expect(screen.queryByText("Not deleted")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete my account" }));

    expect(await screen.findByText("Not deleted")).toBeInTheDocument();
    expect(screen.getByText("That didn't go through.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete my account" }),
    ).toBeInTheDocument();
  });
});
