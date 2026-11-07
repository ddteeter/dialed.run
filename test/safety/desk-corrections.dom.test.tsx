import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  DeskCorrections,
  type DeskCorrectionsProps,
} from "../../src/modules/safety/components/DeskCorrections";
import type { CorrectionGroup } from "../../src/modules/products";
import { renderWithRouter } from "../modules/run-fixtures";

const NOTHING = z.null().parse(JSON.parse("null"));
const PRODUCT ="01HZZZZZZZZZZZZZZZZZZZZZZP";
const NOV_2 = Date.UTC(2026, 10, 2, 12) / 1000;
const NOV_6 = Date.UTC(2026, 10, 6, 12) / 1000;

function group(overrides: Partial<CorrectionGroup> = {}): CorrectionGroup {
  return {
    productId: PRODUCT,
    brandName: "Janji",
    productName: "AFO Middle Layer",
    field: "weight",
    value: "light",
    now: "mid",
    firstAt: NOV_2,
    filers: [
      {
        handle: "hillsplits",
        createdAt: NOV_6,
        note: "It's on the maker's page.",
      },
      { handle: "ada", createdAt: NOV_2, note: NOTHING },
      { handle: NOTHING, createdAt: NOV_2, note: "same" },
    ],
    ...overrides,
  };
}

async function renderQueue(
  groups: CorrectionGroup[],
  overrides: Partial<DeskCorrectionsProps> = {},
) {
  const apply = vi
    .fn<DeskCorrectionsProps["apply"]>()
    .mockResolvedValue({ applied: true });
  const decline = vi
    .fn<DeskCorrectionsProps["decline"]>()
    .mockResolvedValue(undefined);
  const rendered = await renderWithRouter(
    <DeskCorrections
      queue={{ groups, waiting: groups.length, decidedToday: 1 }}
      apply={apply}
      decline={decline}
      {...overrides}
    />,
  );
  return { apply, decline, ...rendered };
}

describe("the Desk's Corrections (R48·130)", () => {
  it("heads the page with D1's count, counting rows", async () => {
    await renderQueue([group()]);
    expect(
      screen.getByRole("heading", { level: 1, name: "Corrections" }),
    ).toBeVisible();
    expect(screen.getByText("1 waiting · 1 decided today")).toBeVisible();
  });

  it("says so when nothing waits", async () => {
    await renderQueue([]);
    expect(screen.getByText("No corrections waiting.")).toBeVisible();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("draws one row: kicker, product, now and suggested in words, the newest runner", async () => {
    await renderQueue([group()]);
    const row = screen.getByRole("article", {
      name: "Janji · AFO Middle Layer",
    });
    expect(
      within(row).getByText("Weight · 3 runners · oldest Nov 2"),
    ).toBeVisible();
    expect(
      within(row).getByRole("heading", {
        level: 2,
        name: "Janji · AFO Middle Layer",
      }),
    ).toBeVisible();
    expect(within(row).getByText("Now").closest("div")).toHaveTextContent(
      "NowMid",
    );
    expect(within(row).getByText("Suggested").closest("div")).toHaveTextContent(
      "SuggestedLight",
    );
    expect(within(row).getAllByRole("listitem")).toHaveLength(1);
    expect(within(row).getByRole("listitem")).toHaveTextContent(
      "@hillsplits · Nov 6 · “It's on the maker's page.”",
    );
  });

  it("opens the rest of the runners inline", async () => {
    const user = userEvent.setup();
    await renderQueue([group()]);
    const more = screen.getByRole("button", { name: "2 more runners" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    const row = screen.getByRole("article");
    const lines = within(row)
      .getAllByRole("listitem")
      .map((line) => line.textContent);
    expect(lines).toStrictEqual([
      "@hillsplits · Nov 6 · “It's on the maker's page.”",
      "@ada · Nov 2",
      "A deleted runner · Nov 2 · “same”",
    ]);
    expect(screen.queryByRole("button", { name: /more runner/u })).toBeNull();
  });

  it("offers no more-runners for a single runner, and counts one runner", async () => {
    await renderQueue([
      group({ filers: [{ handle: "ada", createdAt: NOV_2, note: NOTHING }] }),
    ]);
    expect(screen.getByText("Weight · 1 runner · oldest Nov 2")).toBeVisible();
    expect(screen.queryByRole("button", { name: /more runner/u })).toBeNull();
  });

  it("says a fact the product does not state is not stated", async () => {
    await renderQueue([
      group({ field: "water", value: "yes", now: undefined }),
    ]);
    expect(screen.getByText("Not stated")).toBeVisible();
    expect(screen.getByText("Suggested").closest("div")).toHaveTextContent(
      "SuggestedYes",
    );
  });

  it("applies the row's product, field and value, then reloads", async () => {
    const user = userEvent.setup();
    const { apply, router } = await renderQueue([group()]);
    const invalidate = vi.spyOn(router, "invalidate");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(apply).toHaveBeenCalledWith({
        data: { productId: PRODUCT, field: "weight", value: "light" },
      });
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(await screen.findByText("Applied.")).toBeInTheDocument();
  });

  it("says what to do when the name is another product's, and reloads nothing", async () => {
    const user = userEvent.setup();
    const { router } = await renderQueue(
      [group({ field: "name", value: "Rover" })],
      {
        apply: vi
          .fn<DeskCorrectionsProps["apply"]>()
          .mockResolvedValue({ applied: false, reason: "name_taken" }),
      },
    );
    const invalidate = vi.spyOn(router, "invalidate");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(
      await screen.findByText(
        "Another product of this brand already has that name. Decline it, and look in Duplicates.",
      ),
    ).toBeVisible();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("declines with No reason given by default, after Confirm", async () => {
    const user = userEvent.setup();
    const { decline, apply } = await renderQueue([group()]);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    const reason = screen.getByRole("combobox", { name: "Reason" });
    expect(reason).toHaveValue("none");
    expect(
      within(reason)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toContain("The maker's page says otherwise");
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(decline).toHaveBeenCalledWith({
        data: {
          productId: PRODUCT,
          field: "weight",
          value: "light",
          reason: "none",
        },
      });
    });
    expect(apply).not.toHaveBeenCalled();
    expect(await screen.findByText("Declined.")).toBeInTheDocument();
  });

  it("declines with the reason picked", async () => {
    const user = userEvent.setup();
    const { decline } = await renderQueue([group()]);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Reason" }),
      "not_enough",
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(decline.mock.calls[0]?.[0].data.reason).toBe("not_enough");
    });
  });

  it("goes back to Apply on Cancel, sending nothing", async () => {
    const user = userEvent.setup();
    const { decline } = await renderQueue([group()]);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Apply" })).toBeVisible();
    expect(decline).not.toHaveBeenCalled();
  });

  it("lists rows in the order the server gave them", async () => {
    await renderQueue([
      group(),
      group({ field: "fabric", value: "merino", now: "synthetic" }),
    ]);
    expect(
      screen
        .getAllByRole("article")
        .map((row) => within(row).getByText(/oldest/u).textContent),
    ).toStrictEqual([
      "Weight · 3 runners · oldest Nov 2",
      "Fabric · 3 runners · oldest Nov 2",
    ]);
  });
});
