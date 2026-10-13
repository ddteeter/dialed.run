import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  PRIVATE_COUNTED,
  PRIVATE_NOT_SHOWN,
  PRIVATE_UNCONFIRMED,
  PrivateRunLine,
} from "../../src/modules/onboarding/components/PrivateRunLine";
import {
  TOTALS_LABEL,
  TOTALS_OFF,
  TOTALS_ON,
  TotalsSwitch,
} from "../../src/modules/onboarding/components/TotalsSwitch";

/**
 * D-108's in-app half: Settings › Sharing's "Count my runs in anonymous
 * totals" (D), A3's private line (E). The copy is round 32's, quoted, not paraphrased.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/onboarding/settings"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function totalsBox() {
  return screen.getByRole("checkbox", { name: TOTALS_LABEL });
}

describe("TotalsSwitch (round 32, frames 1a and 1b)", () => {
  it("says the drawn copy, verbatim", () => {
    expect(TOTALS_LABEL).toBe("Count my runs in anonymous totals");
    expect(TOTALS_ON).toBe(
      "Shared and private runs add their temperature, kit and verdict to the guides and reports. Never your name, notes, photos, when you ran, or any place more precise than a broad climate zone.",
    );
    expect(TOTALS_OFF).toBe(
      "Off. Your runs leave the guides at tonight's update. Reports already published stay as they are.",
    );
  });

  it("is on by default with the on line, and links how the guides are made", async () => {
    await renderWithRouter(
      <TotalsSwitch initial save={vi.fn().mockResolvedValue(undefined)} />,
    );
    expect(totalsBox()).toBeChecked();
    expect(totalsBox()).toHaveAccessibleDescription(TOTALS_ON);
    // A placeholder target until the marketing site owns
    // /how-it-works#totals (design-deltas item 61).
    expect(
      screen.getByRole("link", { name: "How the guides are made" }),
    ).toHaveAttribute("href", "/privacy");
  });

  it("saves off on toggle, with no confirm, and swaps to the off line", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    await renderWithRouter(
      <TotalsSwitch initial save={save} onSaved={onSaved} />,
    );

    await user.click(totalsBox());

    expect(save).toHaveBeenCalledWith({ data: { countInTotals: false } });
    await waitFor(() => {
      expect(totalsBox()).not.toBeChecked();
    });
    expect(totalsBox()).toHaveAccessibleDescription(TOTALS_OFF);
    expect(onSaved).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("saves back on from off", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(<TotalsSwitch initial={false} save={save} />);
    expect(totalsBox()).not.toBeChecked();
    expect(totalsBox()).toHaveAccessibleDescription(TOTALS_OFF);

    await user.click(totalsBox());

    expect(save).toHaveBeenCalledWith({ data: { countInTotals: true } });
    await waitFor(() => {
      expect(totalsBox()).toHaveAccessibleDescription(TOTALS_ON);
    });
    // No `onSaved` here, as on Settings: its absence is not a failure.
    expect(screen.queryByText("Not changed")).toBeNull();
  });

  it("stays as it was under a NOT CHANGED band when the save fails, and Try again resends", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("D1 down"))
      .mockResolvedValue(undefined);
    const onSaved = vi.fn();
    await renderWithRouter(
      <TotalsSwitch initial save={save} onSaved={onSaved} />,
    );

    await user.click(totalsBox());

    const band = await screen.findByText("Not changed");
    expect(band.closest("[data-part='failure-band']")).not.toBeNull();
    expect(totalsBox()).toBeChecked();
    expect(totalsBox()).toHaveAccessibleDescription(TOTALS_ON);
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(totalsBox()).not.toBeChecked();
    });
    expect(save).toHaveBeenLastCalledWith({ data: { countInTotals: false } });
    expect(screen.queryByText("Not changed")).toBeNull();
  });

  it("holds the box read-only while the save is in flight", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    const save = vi.fn(() => pending.promise);
    await renderWithRouter(<TotalsSwitch initial save={save} />);

    await user.click(totalsBox());
    expect(totalsBox()).toHaveAttribute("readonly");
    pending.resolve(undefined);
    await waitFor(() => {
      expect(totalsBox()).not.toHaveAttribute("readonly");
    });
  });
});

function line(props: { isVerified: boolean; countInTotals: boolean }) {
  return (
    <PrivateRunLine
      hintId="hint"
      {...props}
      saveCountInTotals={vi.fn().mockResolvedValue(undefined)}
    />
  );
}

describe("PrivateRunLine (round 32, frame 2a)", () => {
  it("says the drawn copy, verbatim", () => {
    expect(PRIVATE_UNCONFIRMED).toBe(
      "Confirm your email to share. This run saves private.",
    );
    expect(PRIVATE_NOT_SHOWN).toBe("Other runners won't see this run.");
    expect(PRIVATE_COUNTED).toBe(
      "Its kit and verdict still count, anonymously, in the guides.",
    );
  });

  it("opted in, says the run still counts, with Change", async () => {
    const { container } = await renderWithRouter(
      line({ isVerified: true, countInTotals: true }),
    );
    expect(container.querySelector("#hint")).toHaveTextContent(
      `${PRIVATE_NOT_SHOWN} ${PRIVATE_COUNTED} Change`,
    );
    // Set as A3's shared line is, so the two states read as one line.
    expect(container.querySelector("#hint")).toHaveClass(
      "text-small",
      "text-muted",
    );
    expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
  });

  it("opted out, is just the first sentence", async () => {
    const { container } = await renderWithRouter(
      line({ isVerified: true, countInTotals: false }),
    );
    expect(container.querySelector("#hint")?.textContent).toBe(
      PRIVATE_NOT_SHOWN,
    );
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("unconfirmed, says round 27's line instead, whatever the setting", async () => {
    const { container } = await renderWithRouter(
      line({ isVerified: false, countInTotals: true }),
    );
    expect(container.querySelector("#hint")?.textContent).toBe(
      PRIVATE_UNCONFIRMED,
    );
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("opens the totals switch in a sheet that Done closes", async () => {
    const user = userEvent.setup();
    await renderWithRouter(line({ isVerified: true, countInTotals: true }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Change" }));
    const sheet = screen.getByRole("dialog", { name: "Sharing" });
    expect(
      within(sheet).getByRole("heading", { level: 2, name: "Sharing" }),
    ).toBeVisible();
    expect(within(sheet).getByRole("checkbox")).toBeChecked();

    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from the platform (Escape) and opens again from Change", async () => {
    const user = userEvent.setup();
    await renderWithRouter(line({ isVerified: true, countInTotals: true }));

    await user.click(screen.getByRole("button", { name: "Change" }));
    const dialog = screen.getByRole("dialog", { name: "Sharing" });
    expect(dialog).toBeVisible();
    // The platform's close, as Escape does it (happy-dom has no Escape
    // handling; test/ui/sheet.dom.test.tsx closes it the same way).
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("no dialog");
    dialog.close();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // The closed state is the line's, not only the dialog's, so Change
    // opens it again.
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("dialog", { name: "Sharing" })).toBeVisible();
  });
});
