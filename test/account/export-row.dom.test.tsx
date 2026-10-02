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

import type { ExportRowState } from "../../src/lib/contracts/data-export";
import { ExportRow } from "../../src/modules/account/components/ExportRow";

/**
 * U1's "Export your data" row (ACC-10; round 27 #13): Get a copy, the
 * board's Preparing state, a ready copy's download, a failed build's
 * "try again" — and a key per press.
 */

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

type Request = (input: {
  data: { idempotencyKey: string };
}) => Promise<ExportRowState>;

function renderRow(
  state: ExportRowState,
  request: Request = vi.fn<Request>().mockResolvedValue({ state: "preparing" }),
  onRequested = vi.fn<() => Promise<void>>().mockResolvedValue(),
) {
  return renderWithRouter(
    <ul>
      <ExportRow state={state} request={request} onRequested={onRequested} />
    </ul>,
  );
}

function row(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[data-part='export-row']");
  if (found === null) throw new Error("no export row");
  return found;
}

/**
The key each press sent, in order.
*/
function keysOf(request: ReturnType<typeof vi.fn<Request>>): string[] {
  return request.mock.calls.map(([input]) => input.data.idempotencyKey);
}

describe("ExportRow", () => {
  it("offers Get a copy, with the board's sub-line", async () => {
    await renderRow({ state: "idle" });
    expect(row().tagName).toBe("LI");
    expect(within(row()).getByText("Export your data")).toBeInTheDocument();
    expect(
      within(row()).getByText(
        "Runs, closet, entries, photos and your run files",
      ),
    ).toBeInTheDocument();
    expect(
      within(row()).getByRole("button", { name: "Get a copy" }),
    ).toBeInTheDocument();
  });

  it("asks once per press, with a fresh key after each the server took, then reloads the row", async () => {
    const user = userEvent.setup();
    const request = vi.fn<Request>().mockResolvedValue({ state: "preparing" });
    const onRequested = vi.fn<() => Promise<void>>().mockResolvedValue();
    await renderRow({ state: "idle" }, request, onRequested);

    await user.click(screen.getByRole("button", { name: "Get a copy" }));
    await waitFor(() => {
      expect(onRequested).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: "Get a copy" }));
    await waitFor(() => {
      expect(onRequested).toHaveBeenCalledTimes(2);
    });

    const [first, second] = keysOf(request);
    expect(first).toMatch(/^[0-9A-Z]{26}$/u);
    expect(second).toMatch(/^[0-9A-Z]{26}$/u);
    expect(second).not.toBe(first);
  });

  it("shows Preparing while the press is in flight", async () => {
    const user = userEvent.setup();
    const answer = Promise.withResolvers<ExportRowState>();
    const request = vi.fn<Request>(() => answer.promise);
    await renderRow({ state: "idle" }, request);

    const button = screen.getByRole("button", { name: /Get a copy/u });
    await user.click(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    answer.resolve({ state: "preparing" });
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy", "true");
    });
  });

  it("says Not started when the press fails, and retries with the same key", async () => {
    const user = userEvent.setup();
    const request = vi
      .fn<Request>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({ state: "preparing" });
    const onRequested = vi.fn<() => Promise<void>>().mockResolvedValue();
    await renderRow({ state: "idle" }, request, onRequested);

    await user.click(screen.getByRole("button", { name: "Get a copy" }));
    const band = await screen.findByText("Not started");
    expect(band.closest("[data-part='failure-band']")).not.toBeNull();
    expect(onRequested).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(onRequested).toHaveBeenCalledTimes(1);
    });
    const [failed, retried] = keysOf(request);
    expect(retried).toBe(failed);
  });

  it("is the board's Preparing state while the ZIP is built — no button", async () => {
    await renderRow({ state: "preparing" });
    expect(
      within(row()).getByText("We'll email a link when it's ready."),
    ).toBeInTheDocument();
    expect(row()).toHaveTextContent("[Preparing]");
    expect(within(row()).queryByRole("button")).toBeNull();
    expect(within(row()).queryByRole("link")).toBeNull();
  });

  it("offers a ready copy as a download of its link, with its last day", async () => {
    const token = "0123456789abcdef0123456789abcdef";
    await renderRow({
      state: "ready",
      token,
      // Fri, Jan 22 2027, UTC.
      expiresAt: 1_800_600_000,
    });
    expect(
      within(row()).getByText("Emailed. The link works until Fri, Jan 22."),
    ).toBeInTheDocument();
    const download = within(row()).getByRole("link", { name: "Download" });
    expect(download).toHaveAttribute("href", `/account/export/${token}`);
    expect(download).toHaveAttribute("download");
    expect(within(row()).queryByRole("button")).toBeNull();
  });

  it("says a failed export didn't work, and offers Get a copy again", async () => {
    await renderRow({ state: "failed" });
    expect(
      within(row()).getByText("Your export didn't work. Try again."),
    ).toBeInTheDocument();
    expect(
      within(row()).getByRole("button", { name: "Get a copy" }),
    ).toBeInTheDocument();
  });
});
