import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  WhoReported,
  type LoadReporters,
} from "../../src/modules/safety/components/WhoReported";

const NOTHING = z.null().parse(JSON.parse("null"));
const QUEUE = "01HZZZZZZZZZZZZZZZZZZZZZZQ";
const NOV_6 = Date.UTC(2026, 10, 6, 12) / 1000;

describe("WHO REPORTED (D-164, R-66)", () => {
  it("is folded, says opening it is logged, and asks for nothing yet", () => {
    const load = vi.fn<LoadReporters>();
    render(<WhoReported queueId={QUEUE} count={2} load={load} />);
    const fold = screen.getByRole("button", { name: /Who reported/u });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(fold).toHaveTextContent("Who reported · 2 ▸");
    expect(
      screen.getByText(
        "Folded. Opening it is logged. Never shown to the author.",
      ),
    ).toBeVisible();
    expect(load).not.toHaveBeenCalled();
  });

  it("reads the reporters when opened, by the row, and lists them", async () => {
    const user = userEvent.setup();
    const load = vi.fn<LoadReporters>().mockResolvedValue([
      { handle: "ada", reason: "spam", createdAt: NOV_6 },
      { handle: NOTHING, reason: "harassment", createdAt: NOV_6 },
    ]);
    render(<WhoReported queueId={QUEUE} count={2} load={load} />);
    await user.click(screen.getByRole("button", { name: /Who reported/u }));
    expect(load).toHaveBeenCalledWith({ data: { queueId: QUEUE } });
    const fold = screen.getByRole("button", { name: /Who reported/u });
    await waitFor(() => {
      expect(fold).toHaveAttribute("aria-expanded", "true");
    });
    expect(fold).toHaveTextContent("Who reported · 2 ▾");
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toStrictEqual([
      "@ada · It's an ad, or it's spam · Nov 6",
      "A closed account · Harassment aimed at someone · Nov 6",
    ]);
    expect(screen.queryByText(/Folded\./u)).toBeNull();
  });

  it("reads once: a second press is the same look", async () => {
    const user = userEvent.setup();
    const load = vi.fn<LoadReporters>().mockResolvedValue([]);
    render(<WhoReported queueId={QUEUE} count={2} load={load} />);
    await user.click(screen.getByRole("button", { name: /Who reported/u }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Who reported/u }),
      ).toHaveAttribute("aria-expanded", "true");
    });
    await user.click(screen.getByRole("button", { name: /Who reported/u }));
    expect(load).toHaveBeenCalledOnce();
  });

  it("stays folded, with a retry, when the read fails", async () => {
    const user = userEvent.setup();
    const load = vi
      .fn<LoadReporters>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([
        { handle: "ada", reason: "spam", createdAt: NOV_6 },
      ]);
    render(<WhoReported queueId={QUEUE} count={2} load={load} />);
    await user.click(screen.getByRole("button", { name: /Who reported/u }));
    const retry = await screen.findByRole("button", { name: /Try again/u });
    expect(screen.getByText(/Still folded/u)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Who reported/u }),
    ).toHaveAttribute("aria-expanded", "false");
    await user.click(retry);
    expect(
      await screen.findByText("@ada · It's an ad, or it's spam · Nov 6"),
    ).toBeVisible();
  });
});
