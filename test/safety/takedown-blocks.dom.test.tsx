import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TakedownBlocks } from "../../src/modules/safety/takedowns/components/TakedownBlocks";
import type { TakedownBlockListed } from "../../src/modules/safety/takedowns/takedown-blocks";

/**
 * Review's Blocked section (design 137): each block on `/takedown`, and
 * its Unblock, which asks in place first.
 */
const AT = 1_800_000_000;
const NETWORK = "f".repeat(64);
/**
How long a form may take to hand its answer over once it has announced it.
*/
const SETTLED_MS = 5000;

const address: TakedownBlockListed = {
  key: "r@example.com",
  kind: "email",
  createdAt: AT,
  address: "r@example.com",
};
const network: TakedownBlockListed = {
  key: NETWORK,
  kind: "ip",
  createdAt: AT,
  address: "r@example.com",
};

const rows = () => [
  ...document.querySelectorAll<HTMLElement>("[data-part='takedown-block']"),
];

describe("Review · Blocked", () => {
  type UnblockFn = Parameters<typeof TakedownBlocks>[0]["unblock"];

  it("is not drawn while nothing is blocked", () => {
    render(<TakedownBlocks blocks={[]} unblock={vi.fn<UnblockFn>()} />);
    expect(screen.queryByRole("heading", { name: "Blocked" })).toBeNull();
    expect(rows()).toStrictEqual([]);
  });

  it("names an address by itself and a network by the request it was blocked from", () => {
    render(
      <TakedownBlocks
        blocks={[
          address,
          network,
          { ...network, key: "e".repeat(64), address: undefined },
        ]}
        unblock={vi.fn<UnblockFn>()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Blocked" })).toBeVisible();
    expect(rows().map((row) => row.textContent)).toStrictEqual([
      "[address]r@example.com · blocked Jan 15Unblock",
      "[network]from a request by r@example.com · blocked Jan 15Unblock",
      "[network]blocked Jan 15Unblock",
    ]);
  });

  it("asks before it unblocks, can be cancelled, and says it is unblocked", async () => {
    const unblock = vi
      .fn<UnblockFn>()
      .mockResolvedValue({ outcome: "unblocked" });
    render(<TakedownBlocks blocks={[network]} unblock={unblock} />);
    const user = userEvent.setup();
    const [row] = rows();
    const inRow = within(row ?? document.body);

    await user.click(inRow.getByRole("button", { name: "Unblock" }));
    expect(
      inRow.getByText(
        "Unblock this network? What it files next hides and alerts as usual.",
      ),
    ).toBeVisible();
    expect(inRow.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(inRow.getByRole("button", { name: "Cancel" }));
    expect(inRow.queryByText(/What it files next/u)).toBeNull();
    expect(inRow.getByRole("button", { name: "Unblock" })).toHaveFocus();
    expect(unblock).not.toHaveBeenCalled();

    await user.click(inRow.getByRole("button", { name: "Unblock" }));
    await user.click(inRow.getByRole("button", { name: "Unblock" }));
    expect(unblock).toHaveBeenCalledWith({ data: { key: NETWORK } });
    await waitFor(
      () => {
        expect(inRow.queryByRole("button")).toBeNull();
      },
      { timeout: SETTLED_MS },
    );
    expect(inRow.getByRole("status")).toHaveTextContent(/^Unblocked\.$/u);
  });

  it("asks of an address as an address", async () => {
    render(
      <TakedownBlocks blocks={[address]} unblock={vi.fn<UnblockFn>()} />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Unblock" }));
    expect(
      screen.getByText(
        "Unblock this address? What it files next hides and alerts as usual.",
      ),
    ).toBeVisible();
  });

  it("says a block someone lifted first is already lifted", async () => {
    const unblock = vi
      .fn<UnblockFn>()
      .mockResolvedValue({ outcome: "not_found" });
    render(<TakedownBlocks blocks={[address]} unblock={unblock} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Unblock" }));
    await user.click(screen.getByRole("button", { name: "Unblock" }));
    await waitFor(
      () => {
        expect(screen.queryByRole("button")).toBeNull();
      },
      { timeout: SETTLED_MS },
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /^That block is already lifted\.$/u,
    );
  });
});
