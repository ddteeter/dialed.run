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
    expect(screen.getByText(/That's normal/)).toBeInTheDocument();
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
    expect(screen.getByText(/not told\. Blocking is quiet/)).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing here is a list anyone else can see/),
    ).toBeInTheDocument();
  });
});

describe("the roster", () => {
  it("counts and names who is blocked", () => {
    render(
      <BlockedRunners
        blocked={[runner(), runner({ userId: "u-2", displayName: "gearfiend22" })]}
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
        blocked={[runner(), runner({ userId: "u-2", displayName: "gearfiend22" })]}
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
