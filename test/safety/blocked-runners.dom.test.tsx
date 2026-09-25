import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BlockedRunners } from "../../src/modules/safety/components/BlockedRunners";
import type { BlockedRunner } from "../../src/modules/safety/blocks";

function runner(overrides: Partial<BlockedRunner> = {}): BlockedRunner {
  return {
    userId: "u-1",
    displayName: "j_holloway",
    blockedAt: 1_755_000_000,
    ...overrides,
  };
}

describe("what the screen leads with", () => {
  it("explains blocking even when nobody is blocked", () => {
    render(<BlockedRunners blocked={[]} unblock={vi.fn()} />);

    // The artboard is explicit that an empty list is the normal case, so
    // the explanation is the body of the screen rather than help text
    // hanging off a roster.
    expect(
      screen.getByRole("heading", { name: /what blocking does/i }),
    ).toBeInTheDocument();
    // Round 22, item 21: one line, no brackets.
    expect(screen.getByText("You haven't blocked anyone.")).toBeInTheDocument();
    expect(screen.queryByText(/That's normal/u)).toBeNull();
    // Nothing has happened yet, so the one status region is silent.
    expect(screen.getByRole("status")).toHaveTextContent(/^$/u);
  });

  it("promises both directions, because one row means both", () => {
    render(<BlockedRunners blocked={[]} unblock={vi.fn()} />);

    expect(
      screen.getByText(/can't see your entries, your closet/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/won't see them in the feed or in search/),
    ).toBeInTheDocument();
  });

  it("keeps the anonymous-conditions carve-out, which is a claim about the code", () => {
    render(<BlockedRunners blocked={[]} unblock={vi.fn()} />);

    // Nothing in blocks.ts is imported by the consensus path, and
    // blocks.test.ts pins that from the outside. This copy is the promise
    // that behaviour makes to a runner, so it is pinned too.
    expect(
      screen.getByText(/verdicts count in anonymous\s+conditions numbers/),
    ).toBeInTheDocument();
  });

  it("says blocking is quiet", () => {
    render(<BlockedRunners blocked={[]} unblock={vi.fn()} />);
    expect(
      screen.getByText(/not told\. Blocking is quiet/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing here is a list anyone else can see/),
    ).toBeInTheDocument();
  });
});

describe("the roster", () => {
  it("counts and names who is blocked", () => {
    render(
      <BlockedRunners
        blocked={[
          runner(),
          runner({ userId: "u-2", displayName: "gearfiend22" }),
        ]}
        unblock={vi.fn()}
      />,
    );

    expect(screen.getByText("[2 blocked]")).toBeInTheDocument();
    expect(screen.getByText("j_holloway")).toBeInTheDocument();
    expect(screen.getByText("gearfiend22")).toBeInTheDocument();
  });

  it("names a runner who has no display name without leaving a gap", () => {
    render(
      <BlockedRunners
        blocked={[runner({ displayName: undefined })]}
        unblock={vi.fn()}
      />,
    );
    expect(screen.getByText("A runner")).toBeInTheDocument();
  });

  it("unblocks immediately and without a confirmation step", async () => {
    const user = userEvent.setup();
    const unblock = vi.fn().mockResolvedValue({});
    render(<BlockedRunners blocked={[runner()]} unblock={unblock} />);

    await user.click(screen.getByRole("button", { name: "Unblock" }));

    // "Unblocking takes effect immediately" — so no dialog, no undo toast.
    // Both would imply the action is heavier than it is.
    expect(unblock).toHaveBeenCalledWith({ data: { userId: "u-1" } });
    await waitFor(() => {
      expect(screen.queryByText("j_holloway")).not.toBeInTheDocument();
    });
    expect(screen.getByText("[0 blocked]")).toBeInTheDocument();
  });

  it("removes only the one unblocked", async () => {
    const user = userEvent.setup();
    render(
      <BlockedRunners
        blocked={[
          runner(),
          runner({ userId: "u-2", displayName: "gearfiend22" }),
        ]}
        unblock={vi.fn().mockResolvedValue({})}
      />,
    );

    const [first] = screen.getAllByRole("button", { name: "Unblock" });
    if (!first) throw new Error("no unblock buttons rendered");
    await user.click(first);

    await waitFor(() => {
      expect(screen.queryByText("j_holloway")).not.toBeInTheDocument();
    });
    expect(screen.getByText("gearfiend22")).toBeInTheDocument();
  });
});

describe("Unblock as a control that can fail (round 22, item 21)", () => {
  it("waits behind [ Unblocking ], keeping the row until the server says yes", async () => {
    const user = userEvent.setup();
    const answer = Promise.withResolvers<unknown>();
    const unblock = vi.fn().mockReturnValue(answer.promise);
    render(<BlockedRunners blocked={[runner()]} unblock={unblock} />);

    const button = screen.getByRole("button", { name: "Unblock" });
    await user.click(button);

    // Not optimistic: the row is still here, the button is busy and still
    // a live control, and its label breathes.
    expect(screen.getByText("j_holloway")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveTextContent("Unblocking");
    expect(button.querySelectorAll(".breathe")).toHaveLength(2);

    // A second press while it waits sends nothing more.
    await user.click(button);
    expect(unblock).toHaveBeenCalledTimes(1);

    answer.resolve({});
    await waitFor(() => {
      expect(screen.queryByText("j_holloway")).not.toBeInTheDocument();
    });
  });

  it("keeps the row on failure, with a band inside it that says Still blocked", async () => {
    const user = userEvent.setup();
    const unblock = vi.fn().mockRejectedValue(new Error("D1 down"));
    render(
      <BlockedRunners
        blocked={[runner(), runner({ userId: "u-2", displayName: "gearfiend22" })]}
        unblock={unblock}
      />,
    );

    const [first] = screen.getAllByRole("button", { name: "Unblock" });
    if (!first) throw new Error("no unblock buttons rendered");
    await user.click(first);

    const band = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-part='failure-band']");
      expect(found).not.toBeNull();
      return found;
    });
    // Inside the row that failed, not the other one and not the page.
    const row = screen.getByText("j_holloway").closest("li");
    expect(row).toContainElement(band);
    expect(screen.getByText("gearfiend22").closest("li")).not.toContainElement(
      band,
    );
    expect(band).toHaveTextContent("Still blocked");
    expect(band).toHaveTextContent("Our end failed.");
    expect(screen.getByText("[2 blocked]")).toBeInTheDocument();
    // The one status region says it once.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Still blocked. Our end failed.",
    );
  });

  it("tries again from the band, and the row leaves when that works", async () => {
    const user = userEvent.setup();
    const unblock = vi
      .fn()
      .mockRejectedValueOnce(new Error("D1 down"))
      .mockResolvedValueOnce({});
    render(<BlockedRunners blocked={[runner()]} unblock={unblock} />);

    await user.click(screen.getByRole("button", { name: "Unblock" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.queryByText("j_holloway")).not.toBeInTheDocument();
    });
    expect(unblock).toHaveBeenCalledTimes(2);
    expect(unblock).toHaveBeenLastCalledWith({ data: { userId: "u-1" } });
    expect(screen.getByRole("status")).toHaveTextContent(/^$/u);
  });
});
