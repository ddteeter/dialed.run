import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  CopyrightHolds,
  holdState,
} from "../../src/modules/safety/components/CopyrightHolds";
import type { CopyrightHoldSummary } from "../../src/modules/safety/copyright-holds";
import { isoDayOf } from "../../src/lib/contracts/age";
import { nowSeconds } from "../../src/lib/now";

/**
 * D-130: Review's copyright holds, and the Desk actions on one —
 * "Counter-notice received", then "Court action filed", then, once the
 * case is over (D-146), "Case over: delete" or "Case over: restore".
 */
type Props = Parameters<typeof CopyrightHolds>[0];
type CounterFn = Props["counterNotice"];
type CourtFn = Props["courtAction"];
type CaseOverFn = Props["caseOverDelete"];

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
  caseOver: Readonly<{ remove?: CaseOverFn; restore?: CaseOverFn }> = {},
) {
  render(
    <CopyrightHolds
      holds={[hold]}
      counterNotice={counterNotice}
      courtAction={courtAction}
      caseOverDelete={caseOver.remove ?? vi.fn<CaseOverFn>()}
      caseOverRestore={caseOver.restore ?? vi.fn<CaseOverFn>()}
    />,
  );
}

/**
A hold under a litigation hold: counter-notice, then court action.
*/
const inCourt = () =>
  held({ counterNoticeAt: OCT_23, restoreAt: NOV_10, courtActionAt: NOV_10 });

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
    ).toBe("court action Nov 10: held until the case is over");
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
    expect(part("hold-said")).toBeNull();
  });

  it("renders nothing when nothing is held", () => {
    render(
      <CopyrightHolds
        holds={[]}
        counterNotice={vi.fn()}
        courtAction={vi.fn()}
        caseOverDelete={vi.fn()}
        caseOverRestore={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(part("copyright-holds")).toBeNull();
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
    // RECEIVED ON defaults to today, by the Desk's UTC clock (round 39 #73).
    expect(counterNotice).toHaveBeenCalledWith({
      data: { holdId: HOLD_ID, receivedOn: isoDayOf(nowSeconds()) },
    });
    await waitFor(() => {
      expect(part("hold-state")?.textContent).toBe(
        "[counter-notice received: back Nov 10]",
      );
    });
    expect(
      screen.getByRole("button", { name: "Court action filed" }),
    ).toBeVisible();
    expect(part("hold-said")?.textContent).toBe("Counter-notice recorded.");
  });

  it("records a court action, and then offers only the case's end", async () => {
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
      await screen.findByText(
        "Court action recorded. It stays hidden until the case is over.",
      ),
    ).toBeInTheDocument();
    expect(courtAction).toHaveBeenCalledWith({ data: { holdId: HOLD_ID } });
    await waitFor(() => {
      expect(part("hold-state")?.textContent).toBe(
        "[court action Nov 10: held until the case is over]",
      );
    });
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Case over: delete" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Case over: restore" }),
    ).toBeVisible();
    // The court action's form is gone; the row keeps what it answered.
    expect(part("hold-said")?.textContent).toBe(
      "Court action recorded. It stays hidden until the case is over.",
    );
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

  it.each([
    [
      "delete",
      "Case over: delete",
      "Delete it for good? It can't be put back.",
      "Delete it",
      "Case over. It is deleted.",
    ],
    [
      "restore",
      "Case over: restore",
      "Put it back where it was?",
      "Put it back",
      "Case over. It is back.",
    ],
  ] as const)(
    "confirms %s in place, then the row leaves the list (round 39 #73)",
    async (which, label, question, yes, sentence) => {
      const act = vi
        .fn<CaseOverFn>()
        .mockResolvedValue({ outcome: "recorded" });
      renderHolds(inCourt(), vi.fn<CounterFn>(), vi.fn<CourtFn>(), {
        [which === "delete" ? "remove" : "restore"]: act,
      });
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: label }));
      // The confirm replaces the pair; nothing is sent until it is answered.
      const confirm = screen.getByRole("alertdialog", { name: question });
      expect(confirm).toHaveTextContent(question);
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      expect(act).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: yes }));

      expect(act).toHaveBeenCalledWith({ data: { holdId: HOLD_ID } });
      await waitFor(() => {
        expect(part("copyright-hold")).toBeNull();
      });
      expect(part("holds-said")?.textContent).toBe(sentence);
      expect(screen.getByRole("status")).toHaveTextContent(sentence);
      // The last hold settled: the list goes, its answer stays.
      expect(screen.queryByRole("heading")).toBeNull();
    },
  );

  it.each([
    ["Case over: delete", "Delete it for good? It can't be put back."],
    ["Case over: restore", "Put it back where it was?"],
  ])(
    "puts the pair back on Not yet, with focus on %s",
    async (label, question) => {
      const act = vi.fn<CaseOverFn>();
      renderHolds(inCourt(), vi.fn<CounterFn>(), vi.fn<CourtFn>(), {
        remove: act,
        restore: act,
      });
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("alertdialog", { name: question })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Not yet" }));

      expect(screen.queryByRole("alertdialog")).toBeNull();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: label })).toHaveFocus();
      });
      expect(screen.getAllByRole("button")).toHaveLength(2);
      expect(act).not.toHaveBeenCalled();
      // Asked again, it confirms again: the pair is the same press.
      await user.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("alertdialog", { name: question })).toBeVisible();
      expect(screen.getByRole("button", { name: "Not yet" })).toHaveClass(
        "target",
        "border-hairline",
      );
    },
  );

  it("draws the pair as the Desk's presses, focusing neither until asked", () => {
    renderHolds(inCourt());
    for (const label of ["Case over: delete", "Case over: restore"]) {
      const press = screen.getByRole("button", { name: label });
      expect(press).toHaveClass("target", "bg-action");
      expect(press).toHaveAttribute("type", "button");
      expect(press).not.toHaveFocus();
    }
  });

  it.each([
    ["Case over: delete", "Delete it"],
    ["Case over: restore", "Put it back"],
  ])("says why %s did not land, and keeps the row", async (label, yes) => {
    const act = vi
      .fn<CaseOverFn>()
      .mockResolvedValueOnce({ outcome: "not_held" })
      .mockResolvedValueOnce({ outcome: "gone" });
    renderHolds(inCourt(), vi.fn<CounterFn>(), vi.fn<CourtFn>(), {
      remove: act,
      restore: act,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: label }));
    const button = screen.getByRole("button", { name: yes });

    await user.click(button);
    expect(
      await screen.findByText("Record the court action first."),
    ).toBeVisible();
    await user.click(button);
    expect(
      await screen.findByText("This hold is settled: put back or deleted."),
    ).toBeVisible();
    expect(part("copyright-hold")).not.toBeNull();
    expect(part("holds-said")).toBeNull();
  });

  it("takes RECEIVED ON, today by default, and sends the day picked", async () => {
    const counterNotice = vi
      .fn<CounterFn>()
      .mockResolvedValue({ outcome: "before_hidden" });
    renderHolds(held(), counterNotice);
    const field = screen.getByLabelText<HTMLInputElement>("Received on");
    expect(field).toHaveAttribute("type", "date");
    expect(field.value).toBe(isoDayOf(nowSeconds()));

    fireEvent.change(field, { target: { value: "2026-10-24" } });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Counter-notice received" }));

    expect(counterNotice).toHaveBeenCalledWith({
      data: { holdId: HOLD_ID, receivedOn: "2026-10-24" },
    });
    // The server holds the hide's line too, and says so in the same words.
    expect(
      await screen.findByText("Pick a date on or after it was hidden."),
    ).toBeVisible();
  });

  it.each([
    ["2026-10-22", "Pick a date on or after it was hidden."],
    [isoDayOf(nowSeconds() + 24 * 60 * 60), "Pick today or an earlier day."],
  ])("refuses RECEIVED ON %s, sending nothing", async (day, sentence) => {
    const counterNotice = vi.fn<CounterFn>();
    renderHolds(held(), counterNotice);

    fireEvent.change(screen.getByLabelText("Received on"), {
      target: { value: day },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Counter-notice received" }));

    const said = await screen.findAllByText(sentence);
    expect(said.length).toBeGreaterThan(0);
    expect(counterNotice).not.toHaveBeenCalled();
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
