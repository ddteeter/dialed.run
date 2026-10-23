import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  CopyrightHolds,
  holdState,
} from "../../src/modules/safety/components/CopyrightHolds";
import type { CopyrightHoldSummary } from "../../src/modules/safety/copyright-holds";

/**
 * D-130: Review's copyright holds, and the two Desk actions on one —
 * "Counter-notice received", then "Court action filed".
 */
type Props = Parameters<typeof CopyrightHolds>[0];
type CounterFn = Props["counterNotice"];
type CourtFn = Props["courtAction"];

const OCT_23 = Date.UTC(2026, 9, 23) / 1000;
const NOV_10 = Date.UTC(2026, 10, 10) / 1000;
const NOV_22 = Date.UTC(2026, 10, 22) / 1000;
const HOLD_ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";
/**
A column D1 left empty, as drizzle reads it back.
*/
const NOT_SET = z.null().parse(JSON.parse("null"));

function held(
  overrides: Partial<CopyrightHoldSummary> = {},
): CopyrightHoldSummary {
  return {
    id: HOLD_ID,
    subjectType: "photo",
    subjectId: "p1",
    ownerId: "runner-1",
    strikes: 2,
    notice: "it uses someone else's work — Acme, ref 7",
    hiddenAt: OCT_23,
    purgeAt: NOV_22,
    counterNoticeAt: NOT_SET,
    restoreAt: NOT_SET,
    courtActionAt: NOT_SET,
    ...overrides,
  };
}

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

function renderHolds(
  hold: CopyrightHoldSummary,
  counterNotice: CounterFn = vi.fn<CounterFn>(),
  courtAction: CourtFn = vi.fn<CourtFn>(),
) {
  render(
    <CopyrightHolds
      holds={[hold]}
      counterNotice={counterNotice}
      courtAction={courtAction}
    />,
  );
}

describe("holdState", () => {
  it("says what the sweep will do, and when", () => {
    expect(holdState(held())).toBe("no counter-notice: deleted Nov 22");
    expect(
      holdState(held({ counterNoticeAt: OCT_23, restoreAt: NOV_10 })),
    ).toBe("counter-notice received: back Nov 10");
    expect(
      holdState(
        held({
          counterNoticeAt: OCT_23,
          restoreAt: NOV_10,
          courtActionAt: NOV_10,
        }),
      ),
    ).toBe("court action Nov 10: stays hidden, deleted Nov 22");
  });
});

describe("CopyrightHolds", () => {
  it("lists a hold with whose it is, their strikes, the notice and its clock", () => {
    renderHolds(held());

    expect(
      screen.getByRole("heading", { name: "Copyright holds · 1" }),
    ).toBeVisible();
    expect(part("copyright-hold")).toHaveTextContent("photo p1");
    expect(part("hidden-at")?.textContent).toBe("Hidden Oct 23");
    expect(part("owner")?.textContent).toBe("Owner runner-1 · strikes 2");
    expect(part("notice")?.textContent).toBe(
      "it uses someone else's work — Acme, ref 7",
    );
    expect(part("hold-state")?.textContent).toBe(
      "[no counter-notice: deleted Nov 22]",
    );
    expect(
      screen.getByRole("button", { name: "Counter-notice received" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Court action filed" }),
    ).toBeNull();
  });

  it("renders nothing when nothing is held", () => {
    render(
      <CopyrightHolds
        holds={[]}
        counterNotice={vi.fn()}
        courtAction={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("records a counter-notice, then offers the court action", async () => {
    const counterNotice = vi.fn<CounterFn>().mockResolvedValue({
      outcome: "recorded",
      counterNoticeAt: OCT_23,
      restoreAt: NOV_10,
    });
    renderHolds(held(), counterNotice);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Counter-notice received" }));

    expect(
      await screen.findByText("Counter-notice recorded."),
    ).toBeInTheDocument();
    expect(counterNotice).toHaveBeenCalledWith({ data: { holdId: HOLD_ID } });
    await waitFor(() => {
      expect(part("hold-state")?.textContent).toBe(
        "[counter-notice received: back Nov 10]",
      );
    });
    expect(
      screen.getByRole("button", { name: "Court action filed" }),
    ).toBeVisible();
  });

  it("records a court action, and then offers nothing more", async () => {
    const courtAction = vi.fn<CourtFn>().mockResolvedValue({
      outcome: "recorded",
      courtActionAt: NOV_10,
    });
    renderHolds(
      held({ counterNoticeAt: OCT_23, restoreAt: NOV_10 }),
      vi.fn<CounterFn>(),
      courtAction,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Court action filed" }));

    expect(
      await screen.findByText("Court action recorded. It stays hidden."),
    ).toBeInTheDocument();
    expect(courtAction).toHaveBeenCalledWith({ data: { holdId: HOLD_ID } });
    await waitFor(() => {
      expect(part("hold-state")?.textContent).toBe(
        "[court action Nov 10: stays hidden, deleted Nov 22]",
      );
    });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why a counter-notice did not land, and changes nothing", async () => {
    const counterNotice = vi
      .fn<CounterFn>()
      .mockResolvedValueOnce({ outcome: "already" })
      .mockResolvedValueOnce({ outcome: "gone" });
    renderHolds(held(), counterNotice);
    const user = userEvent.setup();
    const button = screen.getByRole("button", {
      name: "Counter-notice received",
    });

    await user.click(button);
    expect(
      await screen.findByText("A counter-notice is already recorded."),
    ).toBeVisible();
    await user.click(button);
    expect(
      await screen.findByText("This hold is settled: put back or deleted."),
    ).toBeVisible();
    expect(screen.queryByText("Counter-notice recorded.")).toBeNull();
    expect(part("hold-state")?.textContent).toBe(
      "[no counter-notice: deleted Nov 22]",
    );
  });

  it("says why a court action did not land", async () => {
    const courtAction = vi
      .fn<CourtFn>()
      .mockResolvedValueOnce({ outcome: "already" })
      .mockResolvedValueOnce({ outcome: "no_counter_notice" })
      .mockResolvedValueOnce({ outcome: "gone" });
    renderHolds(
      held({ counterNoticeAt: OCT_23, restoreAt: NOV_10 }),
      vi.fn<CounterFn>(),
      courtAction,
    );
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Court action filed" });

    await user.click(button);
    expect(
      await screen.findByText("A court action is already recorded."),
    ).toBeVisible();
    await user.click(button);
    expect(
      await screen.findByText("Record the counter-notice first."),
    ).toBeVisible();
    await user.click(button);
    expect(
      await screen.findByText("This hold is settled: put back or deleted."),
    ).toBeVisible();
  });

  it("says it is recording while the call is out", async () => {
    const counterNotice = vi.fn<CounterFn>().mockReturnValue(
      new Promise(() => {
        // Never settles.
      }),
    );
    renderHolds(held(), counterNotice);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Counter-notice received" }));

    expect(
      await screen.findByRole("button", { name: "Recording" }),
    ).toHaveAttribute("aria-busy", "true");
  });
});
