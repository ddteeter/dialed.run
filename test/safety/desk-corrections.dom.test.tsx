import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  DeskCorrections,
  type DeskCorrectionsProps,
} from "../../src/modules/safety/components/DeskCorrections";
import type { CorrectionGroup } from "../../src/modules/products";
import { QUIET_CANCEL } from "../../src/ui";
import { renderWithRouter } from "../modules/run-fixtures";
import { carriedSince } from "../ui/carry-spy";

vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
  const { spyOnCarry } = await import("../ui/carry-spy");
  return spyOnCarry(await importOriginal());
});

const NOTHING = z.null().parse(JSON.parse("null"));
const PRODUCT = "01HZZZZZZZZZZZZZZZZZZZZZZP";
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

const NAME_TAKEN =
  "Another product of this brand already has that name. Decline it, and look in Duplicates.";

/**
 * Two rows whose order flips on a press, as a reload that re-sorts the
 * queue does: each row's open state has to follow its own product.
 */
function Reorderable({
  first,
  second,
}: Readonly<{ first: CorrectionGroup; second: CorrectionGroup }>) {
  const [isFlipped, setIsFlipped] = useState(false);
  const groups = isFlipped ? [second, first] : [first, second];
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsFlipped(true);
        }}
      >
        Re-sort
      </button>
      <DeskCorrections
        queue={{ groups, waiting: 2, decidedToday: 0 }}
        apply={vi.fn<DeskCorrectionsProps["apply"]>()}
        decline={vi.fn<DeskCorrectionsProps["decline"]>()}
      />
    </>
  );
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

  it.each([
    ["name", "Rover", "Rove", "Name"],
    ["weight", "light", "mid", "Weight"],
    ["fabric", "merino", "synthetic", "Fabric"],
    ["wind", "yes", "no", "Wind"],
    ["water", "no", "yes", "Water"],
    ["composition", "80% merino", "100% polyester", "Composition"],
    ["link", "https://example.com/afo", "https://example.com/old", "Link"],
  ] as const)(
    "names the %s field %4$s in the row's kicker",
    async (field, value, now, kicker) => {
      await renderQueue([group({ field, value, now })]);
      expect(
        screen.getByText(`${kicker} · 3 runners · oldest Nov 2`),
      ).toBeVisible();
    },
  );

  it("keeps a row's opened runners with its product when the rows re-sort", async () => {
    const user = userEvent.setup();
    const janji = group();
    const other = group({
      productId: "01HZZZZZZZZZZZZZZZZZZZZZZR",
      productName: "Rover",
      filers: [
        { handle: "ada", createdAt: NOV_2, note: NOTHING },
        { handle: "bo", createdAt: NOV_2, note: NOTHING },
      ],
    });
    await renderWithRouter(<Reorderable first={janji} second={other} />);
    await user.click(screen.getByRole("button", { name: "2 more runners" }));
    await user.click(screen.getByRole("button", { name: "Re-sort" }));
    const [top, bottom] = screen.getAllByRole("article");
    expect(top).toHaveAccessibleName("Janji · Rover");
    expect(within(top ?? document.body).getAllByRole("listitem")).toHaveLength(
      1,
    );
    expect(
      within(top ?? document.body).getByRole("button", {
        name: "1 more runner",
      }),
    ).toBeVisible();
    expect(bottom).toHaveAccessibleName("Janji · AFO Middle Layer");
    expect(
      within(bottom ?? document.body).getAllByRole("listitem"),
    ).toHaveLength(3);
  });

  it("carries a lapsed decision back to the page (Au7)", async () => {
    carriedSince();
    await renderQueue([group()]);
    expect(carriedSince()).toStrictEqual(["page"]);
  });

  it.each([
    ["Apply", "Apply", "Applying"],
    ["Decline", "Confirm", "Declining"],
  ])(
    "names %s's answer by its in-flight verb, %3$s",
    async (press, answer, verb) => {
      const user = userEvent.setup();
      const never = Promise.withResolvers<never>().promise;
      await renderQueue([group()], {
        apply: vi.fn<DeskCorrectionsProps["apply"]>().mockReturnValue(never),
        decline: vi
          .fn<DeskCorrectionsProps["decline"]>()
          .mockReturnValue(never),
      });
      if (press === "Decline") {
        await user.click(screen.getByRole("button", { name: "Decline" }));
      }
      const button = screen.getByRole("button", { name: answer });
      await user.click(button);
      await waitFor(() => {
        expect(button).toHaveAccessibleName(verb);
      });
    },
  );

  it("draws Cancel as the Desk's quiet cancel, a full target", async () => {
    const user = userEvent.setup();
    await renderQueue([group()]);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveClass("target", ...QUIET_CANCEL.split(" "));
  });

  it("has one status region until a name is refused", async () => {
    await renderQueue([group()]);
    expect(
      within(screen.getByRole("article")).getAllByRole("status"),
    ).toHaveLength(1);
  });

  it("draws the refusal as a NOT APPLIED band, and drops it at Decline (G-20)", async () => {
    const user = userEvent.setup();
    await renderQueue([group({ field: "name", value: "Rover" })], {
      apply: vi
        .fn<DeskCorrectionsProps["apply"]>()
        .mockResolvedValue({ applied: false, reason: "name_taken" }),
    });
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const line = await screen.findByText(NAME_TAKEN);
    const band = line.closest("[data-part='failure-band']");
    expect(band).toHaveTextContent(`Not applied${NAME_TAKEN}`);
    expect(band).toHaveAttribute("data-state", "refused");
    expect(band?.parentElement).toHaveAttribute("role", "status");

    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.queryByText(NAME_TAKEN)).toBeNull();
  });

  it("sets NOW and SUGGESTED as one two-column list on every card (N3-15)", async () => {
    await renderQueue([group()]);
    const now = screen.getByText("Now").closest("dt");
    const list = now?.closest("dl");
    expect(list).toHaveClass(
      "grid",
      "grid-cols-[auto_minmax(0,1fr)]",
      "items-baseline",
    );
    expect(now?.parentElement).toHaveClass("contents");
    expect(
      screen.getByText("Suggested").closest("dt")?.parentElement,
    ).toHaveClass("contents");
  });

  it("clears the refusal line when the next decision goes through", async () => {
    const user = userEvent.setup();
    await renderQueue([group({ field: "name", value: "Rover" })], {
      apply: vi
        .fn<DeskCorrectionsProps["apply"]>()
        .mockResolvedValueOnce({ applied: false, reason: "name_taken" })
        .mockResolvedValue({ applied: true }),
    });
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(NAME_TAKEN)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("Applied.")).toBeInTheDocument();
    expect(screen.queryByText(NAME_TAKEN)).toBeNull();
  });
});
