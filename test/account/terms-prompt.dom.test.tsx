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
  returnNote,
} from "../../src/modules/account/components/TermsPrompt";
import type {
  AcceptResult,
  TermsPromptView,
} from "../../src/modules/account/terms-acceptance";
import { returnPageName } from "../../src/modules/account/terms-return";

/**
 * ACC-6's terms prompt, as round 29 #6 and round 30 #4 draw it: the
 * signed-out panel, two kickers and leads, the owner's WHAT CHANGED
 * summary, the read link on its own line, D-102's warning, Accept, and the
 * escape line carrying Log out and the way to the account.
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
  {
    accept = () => Promise.resolve("accepted"),
    logOut = () => Promise.resolve(),
    from,
  }: {
    accept?: (input: { data: { version: number } }) => Promise<AcceptResult>;
    logOut?: () => Promise<unknown>;
    from?: string;
  } = {},
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
      from={from}
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

/**
Never accepted: every account so far.
*/
const FIRST: TermsPromptView = {
  state: "ask",
  version: 1,
  isFirst: true,
  changed: [],
};

/**
A version bump the owner summarised.
*/
const BUMP: TermsPromptView = {
  state: "ask",
  version: 2,
  isFirst: false,
  changed: [
    "Photos that show where someone lives are removed.",
    "Accounts can be closed for repeated harassment.",
  ],
};

function landing(): HTMLElement {
  const found = document.querySelector("[data-part='landing']");
  if (!(found instanceof HTMLElement)) throw new Error("no landing");
  return found;
}

function acceptButton(): HTMLElement {
  return screen.getByRole("button", { name: "Accept" });
}

/**
Accept's row, which the bands and the warning sit beside.
*/
function acceptRow(): Element | null {
  return document.querySelector("[data-part='accept']");
}

describe("TermsPrompt · never accepted (round 29 #6)", () => {
  it("is the TERMS kicker and its lead, the read link on its own line, Accept, and the escape line", async () => {
    const { rendered } = prompt(FIRST);
    await rendered;
    expect(
      screen.getByRole("heading", { level: 1, name: "Accept the terms" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-part='panel']")).not.toBeNull();
    const header = document.querySelector("[data-part='header']");
    expect(within(header as HTMLElement).getByText("Terms")).toHaveClass(
      "text-mono-xs",
      "text-cold-text",
    );
    expect(screen.queryByText("Terms updated")).toBeNull();
    expect(landing()).toHaveAttribute("data-state", "ask");
    expect(
      screen.getByText(
        "dialed.run has Terms now. Read them, then accept to carry on.",
      ),
    ).toHaveClass("text-lead");
    // Nothing changed for a runner who never accepted.
    expect(document.querySelector("[data-part='what-changed']")).toBeNull();

    const read = screen.getByRole("link", { name: "Read the Terms" });
    expect(read).toHaveAttribute("href", "/terms");
    // On its own line, so a full target, not the inline exception.
    expect(read).toHaveClass("target", "underline");
    expect(read).not.toHaveAttribute("data-target");

    // Accept is the only filled button.
    expect(acceptButton()).toHaveClass(
      "target",
      "rounded-pill",
      "bg-ink",
      "text-ground",
    );
    // `PendingLabel` keeps Log out's in-flight label in the DOM, hidden.
    expect(landing().textContent.replace("[Logging out]", "")).toContain(
      "Rather not? Log out, or go to your account to export or delete it.",
    );
    // Round 30 #4: the escape line carries both exits, and the Log out
    // pill is gone.
    const logOut = screen.getByRole("button", { name: "Log out" });
    expect(logOut).not.toHaveClass("rounded-pill");
    expect(logOut).toHaveClass("target", "underline", "text-ink");
    expect(logOut.closest("p")).toHaveTextContent(/^Rather not\?/u);
    const account = screen.getByRole("link", { name: "your account" });
    expect(account).toHaveAttribute("href", "/account/sign-in");
    expect(account).toHaveClass("text-ink", "underline", "underline-offset-4");
    expect(account.closest("p")).toBe(logOut.closest("p"));

    expect(document.querySelector("[data-part='return-note']")).toBeNull();
    expect(screen.queryByText(STALE)).toBeNull();
  });
});

describe("TermsPrompt · a version bump (round 29 #6)", () => {
  it("is TERMS UPDATED, its lead, the owner's summary as a list, and the full Terms", async () => {
    const { rendered } = prompt(BUMP);
    await rendered;
    expect(screen.getByText("Terms updated")).toHaveClass("text-cold-text");
    expect(
      screen.getByText(
        "The Terms have changed. Read them, then accept to carry on.",
      ),
    ).toBeVisible();
    const block = screen.getByRole("region", { name: "What changed" });
    expect(block).toHaveAttribute("data-part", "what-changed");
    expect(block).toHaveClass("bg-tint");
    expect(within(block).getByText("What changed")).toHaveClass("text-mono-xs");
    expect(
      within(block)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toStrictEqual([
      "·Photos that show where someone lives are removed.",
      "·Accounts can be closed for repeated harassment.",
    ]);
    // The summary sits under the lead and above the read link.
    expect(block.previousElementSibling).toHaveTextContent(
      "The Terms have changed.",
    );
    expect(block.nextElementSibling).toBe(
      screen.getByRole("link", { name: "Read the full Terms" }),
    );
    expect(screen.queryByRole("link", { name: "Read the Terms" })).toBeNull();
  });

  it("leaves the block out when the owner wrote no summary, as for v1", async () => {
    const { rendered } = prompt({ ...BUMP, changed: [] });
    await rendered;
    expect(screen.getByText("Terms updated")).toBeVisible();
    expect(document.querySelector("[data-part='what-changed']")).toBeNull();
  });
});

describe("TermsPrompt · where Accept goes back to (D-102)", () => {
  it.each([
    ["/runs/new", "Log a run"],
    ["/runs/manual?from=strava#form", "Log a run"],
    ["/closet/new", "Add a garment"],
  ])(
    "warns, from %s, that Accept goes back to %s and what was typed is gone",
    async (from, page) => {
      const { rendered } = prompt(BUMP, { from });
      await rendered;
      const note = document.querySelector("[data-part='return-note']");
      expect(note).toHaveTextContent(
        `After you accept, you'll go back to ${page}. What you typed wasn't kept.`,
      );
      // Above Accept, under the read link.
      expect(note?.nextElementSibling).toBe(acceptRow());
    },
  );

  it("says nothing when no refused save brought them: from login, or from a page with no form", async () => {
    const { rendered } = prompt(BUMP, { from: "/feed" });
    await rendered;
    expect(document.querySelector("[data-part='return-note']")).toBeNull();
  });

  it("names only the form pages, by the heading each wears", () => {
    expect(returnPageName(undefined)).toBeUndefined();
    expect(returnPageName("/")).toBeUndefined();
    expect(returnPageName("/runs")).toBeUndefined();
    expect(returnPageName("/runs/new/extra")).toBeUndefined();
    expect(returnPageName("/runs/new")).toBe("Log a run");
    expect(returnPageName("/closet/new?brand=Janji")).toBe("Add a garment");
    expect(returnNote("Log a run")).toBe(
      "After you accept, you'll go back to Log a run. What you typed wasn't kept.",
    );
  });
});

describe("TermsPrompt · Accept and Log out", () => {
  it("accepts the version it showed, then goes on", async () => {
    const { rendered, user, accept, onAccepted, onStale, logOut } =
      prompt(BUMP);
    await rendered;
    await user.click(acceptButton());
    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
    expect(accept).toHaveBeenCalledWith({ data: { version: 2 } });
    expect(onStale).not.toHaveBeenCalled();
    expect(logOut).not.toHaveBeenCalled();
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it("says NOT ACCEPTED directly above Accept when the terms changed under the page, with no Try again, and loads the new ones", async () => {
    const { rendered, user, onAccepted, onStale } = prompt(BUMP, {
      accept: () => Promise.resolve("stale"),
    });
    await rendered;
    await user.click(acceptButton());
    const stale = await screen.findByText(STALE);
    const band = stale.closest("[data-part='control-failure']");
    expect(band).toHaveAttribute("data-state", "stale");
    expect(band).toHaveClass("border", "border-ink");
    expect(within(band as HTMLElement).getByText("Not accepted")).toHaveClass(
      "text-mono-xs",
    );
    expect(band?.nextElementSibling).toBe(acceptRow());
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(STALE).toBe(
      "The terms changed again while this page was open. Read them once more.",
    );
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("logs out and records nothing", async () => {
    const { rendered, user, accept, logOut } = prompt(FIRST);
    await rendered;
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => {
      expect(logOut).toHaveBeenCalledTimes(1);
    });
    expect(accept).not.toHaveBeenCalled();
  });

  it("puts a failed Accept's band under Accept, and Try again sends it again", async () => {
    const accept = vi
      .fn<() => Promise<AcceptResult>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("accepted");
    const { rendered, user, onAccepted } = prompt(BUMP, { accept });
    await rendered;
    await user.click(acceptButton());
    const kicker = await screen.findByText("Not accepted");
    expect(acceptRow()?.nextElementSibling).toBe(
      kicker.closest("[data-part='failure-band']"),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/^Not accepted\. /u);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
  });

  it("puts a failed Log out's band under the line that holds Log out", async () => {
    const { rendered, user } = prompt(FIRST, {
      logOut: () => Promise.reject(new Error("down")),
    });
    await rendered;
    const logOut = screen.getByRole("button", { name: "Log out" });
    await user.click(logOut);
    const kicker = await screen.findByText("Still logged in");
    expect(logOut.closest("p")?.nextElementSibling).toBe(
      kicker.closest("[data-part='failure-band']"),
    );
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
