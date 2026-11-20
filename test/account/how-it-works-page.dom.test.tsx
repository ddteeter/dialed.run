import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { HowItWorksPage } from "../../src/modules/account/terms/components/HowItWorksPage";

/**
 * `/how-it-works` (M4; Round 53 · 163a–e; #523): the owner's copy on the
 * reading layout. Words are asserted where a rival copy would drift
 * (the Settings path the totals switch names, the reworded Garmin answer).
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/how-it-works"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function bell(): ReactElement {
  return <span data-testid="bell" />;
}

/**
 * The lockup's text: the drawn `[dialed.run]` (hidden from a reader) and the
 * one "dialed.run" it says. Prose that leaves `[dialed.run]` undrawn reads
 * as the bare token instead.
 */
const LOCKUP = "[dialed.run]dialed.run";

async function renderPage() {
  return renderWithRouter(<HowItWorksPage bellState={undefined} bell={bell} />);
}

describe("HowItWorksPage", () => {
  it("titles the page and lists the five sections in the board's order, each linked by id", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "How it works" }),
    ).toBeInTheDocument();
    const names: readonly (readonly [string, string])[] = [
      ["loop", "The loop"],
      ["others", "See what other runners wore"],
      ["invite-only", "Why invite-only?"],
      ["totals", "How the guides are made"],
      ["questions", "Questions"],
    ];
    const contents = screen.getByRole("navigation", { name: "Contents" });
    expect(
      within(contents)
        .getAllByRole("link")
        .map((link) => [link.getAttribute("href"), link.textContent]),
    ).toEqual(names.map(([id, title]) => [`#${id}`, title]));
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .filter((heading) => heading.id !== "")
        .map((heading) => [heading.id, heading.textContent]),
    ).toEqual(names);
  });

  it("leads with the wordmark sentence", async () => {
    await renderPage();
    expect(
      screen.getByText(/keeps what you wore on each run/u).textContent,
    ).toBe(
      `${LOCKUP} keeps what you wore on each run next to the weather and how it felt. Log enough runs and you stop guessing at the closet.`,
    );
  });

  it("draws the loop as four numbered steps, a closing line and a coming-next inset", async () => {
    const { container } = await renderPage();
    const loop = container.querySelector('[data-part="loop"]');
    if (!(loop instanceof HTMLElement)) throw new TypeError("no loop list");
    expect(loop.tagName).toBe("OL");
    const steps = within(loop).getAllByRole("listitem");
    const first = steps.at(0);
    const last = steps.at(3);
    if (first === undefined || last === undefined)
      throw new Error("fewer than four steps");
    expect(steps.map((step) => step.textContent)).toEqual([
      "01Fill your closet. Add what you actually run in. Three pieces is enough to start.",
      "02Log a run. Upload the file from your watch, or enter it by hand. We fill in the weather.",
      "03Say what you wore and how it felt. One tap: way cold, a bit cold, dialed, a bit warm or way warm.",
      "04Share it, or keep it private. You choose for each run.",
    ]);
    expect(within(first).getByText("Fill your closet.").tagName).toBe("STRONG");
    expect(within(last).getByText("04")).toHaveAttribute("aria-hidden", "true");
    expect(first).toHaveClass(
      "grid-cols-[36px_minmax(0,1fr)]",
      "desk:grid-cols-[56px_minmax(0,1fr)]",
      "border-b",
      "border-hairline",
    );
    const comingNext = container.querySelector('[data-part="coming-next"]');
    expect(comingNext?.textContent).toBe(
      `Coming next: once you have logged enough runs, ${LOCKUP} will tell you what to wear before you head out.`,
    );
    expect(container.querySelector('[data-part="coming-next"]')).toHaveClass(
      "bg-panel",
    );
  });

  it("keeps the guides under #totals as four terms and definitions", async () => {
    const { container } = await renderPage();
    const totals = container.querySelector("#totals")?.closest("section");
    const guides = totals?.querySelector('[data-part="guides"]');
    expect(guides?.tagName).toBe("DL");
    const terms = [...(guides?.querySelectorAll("dt") ?? [])].map(
      (term) => term.textContent,
    );
    expect(terms).toEqual([
      "Counted",
      "Never counted",
      "The floor",
      "Turning it off",
    ]);
    expect(guides?.querySelectorAll("dd")[3]).toHaveTextContent(
      'Settings › Privacy › "Count my runs in anonymous totals". Your runs leave the guides at the next rebuild, within a month.',
    );
    expect(guides?.querySelector("div")).toHaveClass(
      "desk:grid-cols-[160px_minmax(0,1fr)]",
    );
  });

  it("says every line of the owner's copy, word for word", async () => {
    await renderPage();
    for (const line of [
      "Over time, each piece in your closet shows the range it works in for you.",
      "Follow runners and see what they wore and how it worked. The feed also shows what runners wore in weather like yours. When someone's kit helps you decide, mark it useful.",
      "We're opening in small batches so we can fix what breaks before more runners rely on it.",
      "We will publish guides to what runners wear at each temperature. They count private runs too, without names. That keeps them honest: shared runs alone would make it look as if runners get it right more often than they do.",
      "the temperature band, the sky, the month, the broad climate zone, the gear worn and how it felt.",
      "your name, notes or photos, when your run started, or where it was beyond the climate zone.",
      "a figure needs at least 5 runners, or 20 if it names a brand. Counts are rounded to the nearest 5, and only confirmed accounts count.",
    ]) {
      expect(screen.getByText(line, { exact: true })).toBeInTheDocument();
    }
    const answers = screen
      .getAllByRole("heading", { level: 3 })
      .map((question) => question.nextElementSibling?.textContent);
    expect(answers[0]).toBe(
      `A private run is seen by you alone. A shared run is seen by runners signed in to ${LOCKUP}. A kit you make public can be seen by anyone, even people without an account, and it never shows when or where you ran. Where you ran is never shown to anyone.`,
    );
    expect(answers[1]).toBe(
      "Only to remind you to log your kit after a run. Strava's API agreement limits what apps like ours may keep, so we never store the activity: not your route, your pace or anything else about it. Disconnect in Settings.",
    );
    expect(answers[3]).toBe(
      "Settings › Account › Delete account. You have 7 days to change your mind, then it is gone, and from our backups within 30 days. You can export your data first, from the same screen. The privacy policy has the details.",
    );
  });

  it("answers four questions in the open, with the Strava and privacy links", async () => {
    await renderPage();
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      "Who sees my runs?",
      "Does it connect to Strava?",
      "And Garmin?",
      "How do I delete my account?",
    ]);
    expect(screen.getByText(/Connecting Garmin is coming/u)).toHaveTextContent(
      "Not yet. Connecting Garmin is coming. Until then, export the run from Garmin Connect and upload the file.",
    );
    expect(
      screen.getByRole("link", { name: "Strava's API agreement" }),
    ).toHaveAttribute("href", "https://www.strava.com/legal/api");
    expect(
      screen.getByRole("link", { name: "privacy policy" }),
    ).toHaveAttribute("href", "/privacy");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ends on Request access, with Log in under it below 720", async () => {
    await renderPage();
    const closing = document.querySelector('[data-part="closing-ask"]');
    if (!(closing instanceof HTMLElement))
      throw new TypeError("no closing ask");
    const ask = within(closing).getByRole("link", { name: "Request access" });
    expect(ask).toHaveAttribute("href", "/account/request-access");
    expect(ask).toHaveClass("bg-action", "self-stretch", "desk:self-start");
    const logIn = within(closing).getByRole("link", { name: "Log in" });
    expect(logIn).toHaveAttribute("href", "/auth/login");
    expect(logIn.closest("p")).toHaveClass("wide:hidden");
    expect(logIn.closest("p")?.textContent).toBe("Have an account? Log in");
  });
});
