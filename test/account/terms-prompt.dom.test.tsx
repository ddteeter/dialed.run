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

import {
  STALE,
  TermsPrompt,
} from "../../src/modules/account/components/TermsPrompt";
import type {
  AcceptResult,
  TermsPromptView,
} from "../../src/modules/account/terms-acceptance";

/**
 * ACC-6's terms prompt (undrawn): the signed-out panel, Accept and Log out,
 * a way to the terms and a way to delete the account instead.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/account/terms"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function prompt(
  view: TermsPromptView,
  accept: (input: {
    data: { version: number };
  }) => Promise<AcceptResult> = () => Promise.resolve("accepted"),
  logOut: () => Promise<unknown> = () => Promise.resolve(),
) {
  const acceptFn = vi.fn(accept);
  const logOutFn = vi.fn(logOut);
  const onAccepted = vi.fn(() => Promise.resolve());
  const onStale = vi.fn(() => Promise.resolve());
  const rendered = renderWithRouter(
    <TermsPrompt
      view={view}
      accept={acceptFn}
      logOut={logOutFn}
      onAccepted={onAccepted}
      onStale={onStale}
    />,
  );
  return {
    accept: acceptFn,
    logOut: logOutFn,
    onAccepted,
    onStale,
    rendered,
    user: userEvent.setup(),
  };
}

const ASK: TermsPromptView = { state: "ask", version: 2 };

describe("TermsPrompt (ACC-6)", () => {
  it("asks in the signed-out panel, linking the terms and Settings › Account", async () => {
    const { rendered } = prompt(ASK);
    await rendered;
    expect(
      screen.getByRole("heading", { level: 1, name: "Accept the terms" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-part='panel']")).not.toBeNull();
    expect(screen.getByText("Terms updated")).toHaveClass(
      "text-mono-xs",
      "text-cold-text",
    );
    const landing = document.querySelector("[data-part='landing']");
    expect(landing).toHaveAttribute("data-state", "ask");
    expect(landing).toHaveTextContent(
      "The Terms have changed. Read them, then accept to carry on.",
    );
    expect(landing).toHaveTextContent(
      "Rather not? Log out, or delete your account in Settings.",
    );
    if (!(landing instanceof HTMLElement)) throw new Error("no landing");
    const terms = within(landing).getByRole("link", { name: "Terms" });
    expect(terms).toHaveAttribute("href", "/terms");
    expect(terms).toHaveClass("text-ink", "underline", "underline-offset-4");
    const deletion = screen.getByRole("link", { name: "delete your account" });
    expect(deletion).toHaveAttribute("href", "/account/sign-in");
    expect(deletion).toHaveClass("text-ink", "underline", "underline-offset-4");
    // Accept is the primary answer, Log out the secondary one.
    expect(screen.getByRole("button", { name: "Accept" })).toHaveClass(
      "target",
      "rounded-pill",
      "bg-ink",
      "text-ground",
    );
    expect(screen.getByRole("button", { name: "Log out" })).toHaveClass(
      "target",
      "rounded-pill",
      "border",
      "border-hairline",
      "text-ink",
    );
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it("accepts the version it showed, then goes on", async () => {
    const { rendered, user, accept, onAccepted, onStale, logOut } =
      prompt(ASK);
    await rendered;
    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
    expect(accept).toHaveBeenCalledWith({ data: { version: 2 } });
    expect(onStale).not.toHaveBeenCalled();
    expect(logOut).not.toHaveBeenCalled();
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it("says so when the terms changed under the page, and loads the new ones", async () => {
    const { rendered, user, onAccepted, onStale } = prompt(ASK, () =>
      Promise.resolve("stale"),
    );
    await rendered;
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText(STALE)).toHaveAttribute(
      "data-state",
      "stale",
    );
    expect(STALE).toBe(
      "The terms changed again while this page was open. Read them once more.",
    );
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("logs out and records nothing", async () => {
    const { rendered, user, accept, logOut } = prompt(ASK);
    await rendered;
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => {
      expect(logOut).toHaveBeenCalledTimes(1);
    });
    expect(accept).not.toHaveBeenCalled();
  });

  it("shows a band when Accept fails, and Try again sends it again", async () => {
    const accept = vi
      .fn<() => Promise<AcceptResult>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("accepted");
    const { rendered, user, onAccepted } = prompt(ASK, accept);
    await rendered;
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("Not accepted")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^Not accepted\. /u);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a band when Log out fails", async () => {
    const { rendered, user } = prompt(
      ASK,
      () => Promise.resolve("accepted"),
      () => Promise.reject(new Error("down")),
    );
    await rendered;
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByText("Still logged in")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Still logged in\. /u,
    );
  });

  it("draws nothing when there is nothing to ask", async () => {
    const { rendered } = prompt({ state: "none" });
    await rendered;
    expect(screen.queryByRole("heading")).toBeNull();
    expect(document.querySelector("[data-part='landing']")).toBeNull();
  });
});
