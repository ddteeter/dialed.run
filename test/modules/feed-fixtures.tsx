import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, vi } from "vitest";

import { EMAIL_UNCONFIRMED_CODE } from "../../src/lib/auth-signal";
import type { FeedItem } from "../../src/modules/feed/feed";
import type { ConfirmGate } from "../../src/ui";
import { BellProvider } from "../../src/ui/PhoneBell";
import { UnconfirmedRefusalAnswer } from "../../src/ui/unconfirmed-refusal";

/**
 * The routes the feed's screens link to, stubbed, so a typed `<Link>`
 * resolves and a click can be followed. The screen itself is at `at`, a
 * literal path, which outranks a stub's `$param` at the same place.
 */
function feedRouter(element: ReactElement, at: string) {
  const rootRoute = createRootRoute();
  const stub = (path: string, text: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>{text}</p>,
    });
  // Under the answer the root mounts, so a control the server refuses for
  // want of a confirmed address opens the stand-in sheet (D-113). Mounted
  // where the history starts, so a screen can be put under /feed and its
  // links' `aria-current` is the router's real answer there.
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: at,
    component: () => (
      <UnconfirmedRefusalAnswer gate={CONFIRM_FIRST}>
        {element}
      </UnconfirmedRefusalAnswer>
    ),
  });
  return createRouter({
    routeTree: rootRoute.addChildren([
      screenRoute,
      stub("/feed", "The feed"),
      stub("/feed/entry/$entryId", "An entry"),
      stub("/feed/search", "Search"),
      stub("/feed/verdict/$entryId", "Verdict"),
      stub("/feed/u/$handle", "A profile"),
      stub("/call", "The Call"),
      stub("/runs/backlog", "Backlog"),
      stub("/runs/new", "Log a run"),
      stub("/settings", "Settings"),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
}

export async function renderFeedScreen(element: ReactElement, at = "/") {
  const router = feedRouter(element, at);
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

/**
 * The screen's first paint, as the server sends it — before any effect
 * runs. The one place a region's starting text can be read: a child that
 * reports into it on mount has overwritten it by the time a DOM test looks.
 */
export async function firstPaintOf(element: ReactElement): Promise<string> {
  const router = feedRouter(element, "/");
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

export const NOW = 1_755_000_000;

export function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    entryId: "01ENTRY",
    userId: "01USER",
    authorUsername: undefined,
    runId: "01RUN",
    runTitle: "Evening run",
    distanceM: 8047,
    durationS: 1830,
    startedAt: NOW - 2 * 3600,
    indoor: false,
    deviceName: undefined,
    verdict: undefined,
    createdAt: NOW,
    itemNames: [],
    photoKeys: [],
    tags: [],
    usefulCount: 0,
    viewerHasReacted: false,
    conditions: undefined,
    underReview: false,
    isOwn: false,
    ...overrides,
  };
}

export const MILES = { temp: "f", distance: "mi" } as const;

/**
 * The root's confirm sheet, for the screens whose Useful, report and
 * follow wait on a confirmed address (seam 7; D-113): a stand-in for
 * `account`'s sheet — a dialog named as the real one is, present only
 * while open, saying which control opened it — and Not now closes it. It
 * opens only on the server's refusal, so a screen whose server says yes
 * never shows it.
 */
const CONFIRM_FIRST: ConfirmGate = {
  sheet: ({ open, trigger }, onClose) =>
    open ? (
      <div role="dialog" aria-label="Confirm your email first">
        <p>Opened from {trigger}</p>
        <button type="button" onClick={onClose}>
          Not now
        </button>
      </div>
    ) : undefined,
};

/**
 * The verification gate's refusal, as a server function rejects with it:
 * a plain object, cloned, carrying the code (design 133).
 */
export function unconfirmed(): Promise<never> {
  return Promise.reject(
    Object.assign(new Error("Confirm your email first."), {
      code: EMAIL_UNCONFIRMED_CODE,
    }),
  );
}

/**
 * A screen under a belled `Layout`, as every feed route draws it: the bell
 * it was given, for the screen's `PhoneBell` to seat.
 */
export function withBell(element: ReactElement): ReactElement {
  return (
    <BellProvider value={<button type="button">Notifications</button>}>
      {element}
    </BellProvider>
  );
}

/**
 * Design 169.1: the phone's bell is the last thing on the screen's own
 * first row, the row that holds `first`.
 */
export function expectBellEnding(first: HTMLElement): void {
  const seat = screen
    .getByRole("button", { name: "Notifications" })
    .closest("[data-slot='notification-bell']");
  expect(seat).toHaveClass("wide:hidden");
  expect(seat?.parentElement).toContainElement(first);
  expect(seat?.parentElement?.lastElementChild).toBe(seat);
}

/**
 * The window at a width, as `matchMedia` answers for the desk query
 * (`kit-push.ts`), with a `resize` that crosses the breakpoint and tells
 * whoever listens. Undo it with `vi.unstubAllGlobals()`.
 */
export function atWidth(isDesk: boolean): {
  resize: (isToDesk: boolean) => void;
} {
  let isDeskNow = isDesk;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return isDeskNow && query === "(min-width: 1040px)";
      },
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
    })),
  );
  return {
    resize: (isToDesk) => {
      isDeskNow = isToDesk;
      for (const listener of listeners) listener();
    },
  };
}
