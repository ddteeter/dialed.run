import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ReleaseHolds,
  type ReleaseHoldsFn,
} from "../../src/modules/safety/components/ReleaseHolds";
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
        "Each one is approved as if you'd pressed Approve on it: it goes back where an Approve puts it, and anyone an Approve tells is told. Use this when a bug held them, not to skip looking.",
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
});
