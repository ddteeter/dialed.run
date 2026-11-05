import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ReleaseHolds,
  type ReleaseHoldsFn,
} from "../../src/modules/safety/components/ReleaseHolds";
import type { ReleaseOutcome } from "../../src/modules/safety/release";
import { renderWithRouter } from "../modules/run-fixtures";

/**
 * Design 164: Review offers to release a burst of one cause's holds from
 * the last day, behind a confirm, pressing the server function until none
 * of that cause and day is left.
 */

const SINCE = 1_000_000;

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

describe("ReleaseHolds", () => {
  it("shows nothing when nothing is waiting", async () => {
    const release = vi.fn<ReleaseHoldsFn>();
    await renderWithRouter(
      <ReleaseHolds bursts={[]} since={SINCE} release={release} />,
    );
    expect(part("release-holds")).toBeNull();
  });

  it("lists each cause with what is waiting, and an Approve-them-all", async () => {
    const release = vi.fn<ReleaseHoldsFn>();
    await renderWithRouter(
      <ReleaseHolds
        bursts={[
          { cause: "fingerprint", waiting: 37 },
          { cause: "reports", waiting: 2 },
          { cause: "classifier", waiting: 4 },
        ]}
        since={SINCE}
        release={release}
      />,
    );
    expect(part("release-holds")).toHaveTextContent(
      "Held in the last day" +
        "Fingerprint matches · 37 waitingApprove all 37" +
        "Reports · 2 waitingApprove all 2" +
        "Screener · 4 waitingApprove all 4",
    );
    expect(release).not.toHaveBeenCalled();
  });

  it("asks first, then releases until nothing of that cause and day is left", async () => {
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockResolvedValueOnce({ released: 50, hasMore: true })
      .mockResolvedValueOnce({ released: 3, hasMore: false });
    await renderWithRouter(
      <ReleaseHolds
        bursts={[{ cause: "classifier", waiting: 53 }]}
        since={SINCE}
        release={release}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve all 53" }));
    expect(
      screen.getByRole("heading", { name: "Approve 53 screener holds?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Each one is approved as if you'd pressed Approve on it: it goes back where an Approve puts it, and whoever Approve would tell is told. Use this when a bug held them, not to skip looking.",
      ),
    ).toBeInTheDocument();
    expect(part("sheet")?.dataset.state).toBe("confirm-release-classifier");
    expect(release).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));

    await waitFor(() => {
      expect(release).toHaveBeenCalledTimes(2);
    });
    expect(release.mock.calls).toStrictEqual([
      [{ data: { cause: "classifier", since: SINCE } }],
      [{ data: { cause: "classifier", since: SINCE } }],
    ]);
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Approve 53 screener holds?" }),
      ).toBeNull();
    });
  });

  it("counts what it has approved while it works", async () => {
    const first = Promise.withResolvers<ReleaseOutcome>();
    const second = Promise.withResolvers<ReleaseOutcome>();
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    await renderWithRouter(
      <ReleaseHolds
        bursts={[{ cause: "fingerprint", waiting: 53 }]}
        since={SINCE}
        release={release}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve all 53" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    expect(
      await screen.findByRole("button", { name: "Approving" }),
    ).toBeInTheDocument();

    first.resolve({ released: 50, hasMore: true });
    expect(
      await screen.findByRole("button", { name: "Approved 50 of 53" }),
    ).toBeInTheDocument();

    second.resolve({ released: 3, hasMore: false });
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", {
          name: "Approve 53 fingerprint holds?",
        }),
      ).toBeNull();
    });
  });

  it("names each cause's holds in the confirm", async () => {
    const release = vi.fn<ReleaseHoldsFn>();
    await renderWithRouter(
      <ReleaseHolds
        bursts={[
          { cause: "fingerprint", waiting: 5 },
          { cause: "reports", waiting: 3 },
        ]}
        since={SINCE}
        release={release}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve all 5" }));
    expect(
      screen.getByRole("heading", { name: "Approve 5 fingerprint holds?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));

    fireEvent.click(screen.getByRole("button", { name: "Approve all 3" }));
    expect(
      screen.getByRole("heading", { name: "Approve 3 reported items?" }),
    ).toBeInTheDocument();
  });

  it("opens on Keep it, which closes it and sends nothing", async () => {
    const release = vi.fn<ReleaseHoldsFn>();
    await renderWithRouter(
      <ReleaseHolds
        bursts={[{ cause: "fingerprint", waiting: 5 }]}
        since={SINCE}
        release={release}
      />,
    );
    // Nothing has left, so nothing takes focus on arrival.
    expect(
      screen.getByText("Held in the last day").closest("[tabindex]"),
    ).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Approve all 5" }));
    const keep = screen.getByRole("button", { name: "Keep it" });
    await waitFor(() => {
      expect(keep).toHaveFocus();
    });
    expect(keep).toHaveClass("rounded-pill", "border-hairline", "w-full");
    // No band until a release stops or fails.
    expect(part("failure-band")).toBeNull();
    fireEvent.click(keep);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(release).not.toHaveBeenCalled();
  });

  it("stops after the batch in flight, says how far it got, and offers the rest (round 45 #103)", async () => {
    const first = Promise.withResolvers<ReleaseOutcome>();
    const rest = Promise.withResolvers<ReleaseOutcome>();
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => rest.promise);
    const { router } = await renderWithRouter(
      <ReleaseHolds
        bursts={[{ cause: "fingerprint", waiting: 120 }]}
        since={SINCE}
        release={release}
      />,
    );
    const invalidate = vi.spyOn(router, "invalidate");
    fireEvent.click(screen.getByRole("button", { name: "Approve all 120" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));

    // While it works, Keep it is Stop, and Esc does not close the sheet.
    const stop = await screen.findByRole("button", { name: "Stop" });
    expect(stop).toHaveClass("rounded-pill", "border-hairline", "w-full");
    expect(screen.queryByRole("button", { name: "Keep it" })).toBeNull();
    const dialog = document.querySelector("dialog") ?? document.body;
    const esc = new Event("cancel", { cancelable: true });
    fireEvent(dialog, esc);
    expect(esc.defaultPrevented).toBe(true);
    fireEvent.click(stop);
    first.resolve({ released: 50, hasMore: true });

    const band = await screen.findByText("Stopped");
    expect(band.closest("[data-part='failure-band']")).toHaveAttribute(
      "data-state",
      "stopped",
    );
    expect(
      screen.getByText("Approved 50 of 120. The other 70 are still waiting."),
    ).toBeInTheDocument();
    expect(release).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    });
    // Stopped, Esc closes it again.
    const idle = new Event("cancel", { cancelable: true });
    fireEvent(dialog, idle);
    expect(idle.defaultPrevented).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();

    // The rest picks up where it stopped, and counts on from there.
    fireEvent.click(screen.getByRole("button", { name: "Approve the rest" }));
    await waitFor(() => {
      expect(release).toHaveBeenCalledTimes(2);
    });
    // Working again: the band has gone, and the count carries on.
    expect(part("failure-band")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Approved 50 of 120" }),
    ).toBeInTheDocument();
    rest.resolve({ released: 70, hasMore: false });
    await waitFor(() => {
      expect(part("release-holds")).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("says NOT FINISHED, and how far it got, when a batch fails", async () => {
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockResolvedValueOnce({ released: 50, hasMore: true })
      .mockRejectedValueOnce(new Error("D1 down"))
      .mockResolvedValueOnce({ released: 1, hasMore: false });
    await renderWithRouter(
      <ReleaseHolds
        bursts={[{ cause: "reports", waiting: 51 }]}
        since={SINCE}
        release={release}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve all 51" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));

    const band = await screen.findByText("Not finished");
    expect(band.closest("[data-part='failure-band']")).toHaveAttribute(
      "data-state",
      "failed",
    );
    // One left: the sentence says so in the singular.
    expect(
      screen.getByText("Approved 50 of 51. The other 1 is still waiting."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Not finished.");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve the rest" }));
    await waitFor(() => {
      expect(part("release-holds")).toBeNull();
    });
  });

  it("refreshes the counts when it is kept after approving some, and not before", async () => {
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockResolvedValueOnce({ released: 50, hasMore: true })
      .mockRejectedValueOnce(new Error("D1 down"));
    const { router } = await renderWithRouter(
      <ReleaseHolds
        bursts={[{ cause: "reports", waiting: 90 }]}
        since={SINCE}
        release={release}
      />,
    );
    const invalidate = vi.spyOn(router, "invalidate");
    fireEvent.click(screen.getByRole("button", { name: "Approve all 90" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(invalidate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Approve all 90" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await screen.findByText("Not finished");
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(invalidate).toHaveBeenCalledTimes(1);
    // The line stays: what is left still waits.
    expect(part("release-holds")).toHaveTextContent("Reports · 90 waiting");
  });

  it("sends focus to the next line once a release finishes", async () => {
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockResolvedValue({ released: 2, hasMore: false });
    await renderWithRouter(
      <ReleaseHolds
        bursts={[
          { cause: "fingerprint", waiting: 2 },
          { cause: "reports", waiting: 3 },
        ]}
        since={SINCE}
        release={release}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve all 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve all 3" }),
      ).toHaveFocus();
    });
    expect(part("release-holds")).not.toHaveTextContent("Fingerprint");
  });

  it("sends focus to the section's heading when the last line goes and others stay", async () => {
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockResolvedValue({ released: 3, hasMore: false });
    await renderWithRouter(
      <ReleaseHolds
        bursts={[
          { cause: "fingerprint", waiting: 2 },
          { cause: "reports", waiting: 3 },
        ]}
        since={SINCE}
        release={release}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve all 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await waitFor(() => {
      expect(
        screen.getByText("Held in the last day").closest("[tabindex]"),
      ).toHaveFocus();
    });
  });

  it("sends focus to Review's heading when no line is left", async () => {
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockResolvedValue({ released: 2, hasMore: false });
    await renderWithRouter(
      <>
        <h1 tabIndex={-1}>Review</h1>
        <ReleaseHolds
          bursts={[{ cause: "fingerprint", waiting: 2 }]}
          since={SINCE}
          release={release}
        />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve all 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review" })).toHaveFocus();
    });
    expect(part("release-holds")).toBeNull();
  });

  it("lands focus afresh for each line released at the same place", async () => {
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockResolvedValue({ released: 9, hasMore: false });
    await renderWithRouter(
      <ReleaseHolds
        bursts={[
          { cause: "fingerprint", waiting: 2 },
          { cause: "reports", waiting: 3 },
          { cause: "classifier", waiting: 4 },
        ]}
        since={SINCE}
        release={release}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve all 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve all 3" }),
      ).toHaveFocus();
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve all 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve all 4" }),
      ).toHaveFocus();
    });
  });

  it("lands nowhere, and breaks nothing, with no heading on the page to take focus", async () => {
    const release = vi
      .fn<ReleaseHoldsFn>()
      .mockResolvedValue({ released: 2, hasMore: false });
    await renderWithRouter(
      <>
        <p>the rest of Review</p>
        <ReleaseHolds
          bursts={[{ cause: "fingerprint", waiting: 2 }]}
          since={SINCE}
          release={release}
        />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve all 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await waitFor(() => {
      expect(part("release-holds")).toBeNull();
    });
    expect(screen.getByText("the rest of Review")).toBeInTheDocument();
  });
});
