import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { TakedownConfirm } from "../../src/modules/safety/components/TakedownConfirm";
import { takedownConfirmSearch } from "../../src/modules/safety/inputs";
import { carriedSince } from "../ui/carry-spy";

vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
  const { spyOnCarry } = await import("../ui/carry-spy");
  return spyOnCarry(await importOriginal());
});

/**
 * `/takedown/confirm` (design 137): asks before it confirms, because mail
 * scanners follow links, and says what happened.
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

type ConfirmFn = Parameters<typeof TakedownConfirm>[0]["confirm"];

const TOKEN = "a".repeat(64);

describe("/takedown/confirm", () => {
  it("asks, and confirms nothing until the button is pressed", async () => {
    const confirm = vi.fn<ConfirmFn>();
    await renderWithRouter(<TakedownConfirm token={TOKEN} confirm={confirm} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Confirm your request" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Confirm that you asked us to remove an image. Then we hide it while we look.",
      ),
    ).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("sends the token and says it is confirmed", async () => {
    const confirm = vi
      .fn<ConfirmFn>()
      .mockResolvedValue({ outcome: "confirmed" });
    await renderWithRouter(<TakedownConfirm token={TOKEN} confirm={confirm} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Confirm the request" }));
    // Announced before the receipt replaces the form.
    expect(await screen.findByText("Request confirmed.")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "We have your request" }),
      ).toBeVisible();
    });
    expect(screen.getByText("Request confirmed")).toBeVisible();
    expect(
      screen.getByText(
        "We'll decide within 48 hours and email you either way.",
      ),
    ).toBeVisible();
    expect(
      document.querySelector("[data-part='elsewhere-help']"),
    ).toBeVisible();
    expect(confirm).toHaveBeenCalledWith({ data: { token: TOKEN } });
  });

  it("says a decided request was decided", async () => {
    const confirm = vi
      .fn<ConfirmFn>()
      .mockResolvedValue({ outcome: "decided" });
    await renderWithRouter(<TakedownConfirm token={TOKEN} confirm={confirm} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Confirm the request" }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "We've already decided" }),
      ).toBeVisible();
    });
    expect(
      screen.getByText("We've emailed you what we decided."),
    ).toBeVisible();
    // The other sites are for DONE only (round 41 #85).
    expect(document.querySelector("[data-part='elsewhere-help']")).toBeNull();
  });

  it("says a link that matches nothing does not work, before or after asking", async () => {
    const { unmount } = await renderWithRouter(
      <TakedownConfirm token={undefined} confirm={vi.fn<ConfirmFn>()} />,
    );
    const sentence =
      "This link doesn't match a request. Use the link in the email we sent, or make the request again.";
    expect(screen.getByText(sentence)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    unmount();

    const confirm = vi
      .fn<ConfirmFn>()
      .mockResolvedValue({ outcome: "not_found" });
    await renderWithRouter(<TakedownConfirm token={TOKEN} confirm={confirm} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Confirm the request" }));
    expect(await screen.findByText(sentence)).toBeVisible();
  });
});

describe("its search", () => {
  it("keeps a token only when it is 64 hex characters", () => {
    expect(takedownConfirmSearch({ token: TOKEN })).toStrictEqual({
      token: TOKEN,
    });
    // 64 hex characters with anything before or after is not a token.
    for (const token of [
      "A".repeat(64),
      "a".repeat(63),
      `x${TOKEN}`,
      `${TOKEN}x`,
      7,
      undefined,
    ]) {
      expect(takedownConfirmSearch({ token })).toStrictEqual({
        token: undefined,
      });
    }
  });
});

describe("/takedown/confirm, a signed-out form: a lapsed session (Au7, D-151)", () => {
  it("carries nothing to log-in", async () => {
    carriedSince();
    await renderWithRouter(
      <TakedownConfirm token={TOKEN} confirm={vi.fn<ConfirmFn>()} />,
    );

    expect(carriedSince()).toEqual([undefined]);
  });
});
