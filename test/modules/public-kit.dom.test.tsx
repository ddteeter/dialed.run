import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PublicKitPage } from "../../src/modules/feed/components/PublicKit";
import {
  NotPublicPage,
  type AskSignedIn,
  useSignedInAfterLoad,
} from "../../src/modules/feed/components/PublicFrame";
import type { PublicKit } from "../../src/modules/feed/public-kit-shape";

/**
 * `/kit/<id>` and its not-public twin (round 41 #86c, #86f).
 */

const ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";

const BARE: PublicKit = {
  entryId: ID,
  handle: "maya_runs",
  day: "Sat Oct 18",
  distance: { value: "6.2", unit: "mi" },
  time: { value: "52:10", said: "52 minutes 10 seconds", isMoving: false },
  pieces: [],
  cardVersion: "0123456789abcdef",
};

const CONDITIONS = {
  feelsLike: "38°",
  sky: "damp",
  said: "38 degrees, damp",
  isProviders: true,
};

/**
 * A stat's drawn text: the said halves are sr-only and the drawn ones
 * aria-hidden, so what is drawn is every innermost span not sr-only.
 */
function drawnText(element: HTMLElement): string {
  return [...element.querySelectorAll("span:not(.sr-only)")]
    .filter((span) => span.children.length === 0)
    .map((span) => span.textContent)
    .join("");
}

/**
A stat's said text, when it is said other than as drawn.
*/
function saidText(element: HTMLElement): string | undefined {
  return element.querySelector(".sr-only")?.textContent;
}

const KIT: PublicKit = {
  ...BARE,
  conditions: CONDITIONS,
  verdict: -1,
  time: { value: "52:10", said: "52 minutes 10 seconds", isMoving: true },
  pace: {
    value: "8:25",
    unit: "/mi",
    said: { value: "8 minutes 25 seconds", unit: "per mile" },
  },
  gain: { value: "210", unit: "ft" },
  pieces: [
    {
      name: "Tracksmith Brighton Base Layer",
      model: "Brighton Base Layer",
      kind: "L/S crew",
      url: "https://tracksmith.com/brighton",
    },
    { name: "Old black beanie", model: "Old black beanie", kind: "Headwear" },
  ],
};

const KIT_URL = `https://dialed.run/kit/${ID}`;

const SIGNED_OUT: AskSignedIn = () => Promise.resolve({ signedIn: false });
const SIGNED_IN: AskSignedIn = () => Promise.resolve({ signedIn: true });

function routerFor(element: ReactElement) {
  const rootRoute = createRootRoute();
  const stub = (path: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>at {path}</p>,
    });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      stub("/auth/login"),
      stub("/feed/entry/$entryId"),
      stub("/takedown"),
      stub("/join"),
      stub("/privacy"),
      stub("/terms"),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

/**
The page as the server sends it, before any effect has run.
*/
async function firstPaint(element: ReactElement): Promise<string> {
  const router = routerFor(element);
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

async function show(element: ReactElement) {
  const router = routerFor(element);
  await router.load();
  return render(<RouterProvider router={router} />);
}

function kitPage(kit: PublicKit, ask: AskSignedIn = SIGNED_OUT) {
  return (
    <PublicKitPage kit={kit} origin="https://dialed.run" askSignedIn={ask} />
  );
}

function link(name: string): HTMLElement {
  return screen.getByRole("link", { name });
}

describe("the public kit, signed out", () => {
  it("names the runner and the day, never a time", async () => {
    await show(kitPage(KIT));

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/^@maya_runs$/u);
    expect(heading).toBeVisible();
    // The runner's name in body weight, not a display headline.
    expect(heading).toHaveClass("text-body", "font-semibold");
    expect(screen.getByText("Sat Oct 18")).toHaveClass("text-mono-xs");
  });

  it("leads with the conditions, the measured word teal, and the verdict's chip in its hue", async () => {
    await show(kitPage(KIT));

    const drawn = screen.getByText("38°", { exact: false });
    expect(drawn).toHaveTextContent(/^38° damp$/u);
    expect(within(drawn).getByText("damp")).toHaveClass("text-dialed-text");
    // Round 52 #158: drawn for the eye, said in words.
    expect(drawn).toHaveAttribute("aria-hidden", "true");
    const conditions = drawn.parentElement;
    expect(conditions).toHaveClass("font-display", "text-display");
    expect(
      within(conditions ?? document.body).getByText("38 degrees, damp"),
    ).toHaveClass("sr-only", "normal-case");
    expect(screen.getByText("Feels like · Sky")).toBeVisible();
    const chip = screen.getByText("A bit cold").closest("span[data-part]");
    expect(chip).toHaveAttribute("data-part", "verdict-chip");
    expect(chip).toHaveClass("rounded-pill", "border", "bg-action");
  });

  it("gives the four stats, each number over its word", async () => {
    await show(kitPage(KIT));

    expect(
      screen.getAllByRole("term").map((term) => drawnText(term)),
    ).toStrictEqual(["mi", "moving", "/mi", "ft gain"]);
    expect(
      screen.getAllByRole("definition").map((value) => drawnText(value)),
    ).toStrictEqual(["6.2", "52:10", "8:25", "210"]);
  });

  it("says the time and the pace in words, where the drawn ones read as a clock and a slash", async () => {
    await show(kitPage(KIT));

    expect(
      screen.getAllByRole("term").map((term) => saidText(term)),
    ).toStrictEqual([undefined, undefined, "per mile", undefined]);
    expect(
      screen.getAllByRole("definition").map((value) => saidText(value)),
    ).toStrictEqual([
      undefined,
      "52 minutes 10 seconds",
      "8 minutes 25 seconds",
      undefined,
    ]);
    expect(screen.getByText("8:25")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("/mi")).toHaveAttribute("aria-hidden", "true");
  });

  it("names a run's own clock as time, and leaves out what it has not got", async () => {
    await show(kitPage(BARE));

    const words = screen.getAllByRole("term").map((term) => term.textContent);
    expect(words).toStrictEqual(["mi", "time"]);
    expect(screen.queryByText("Feels like · Sky")).not.toBeInTheDocument();
    expect(document.querySelector('[data-part="conditions"]')).toBeNull();
    expect(document.querySelector('[data-part="caption"]')).toBeNull();
    expect(
      screen.queryByRole("heading", { name: /^The kit/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", {
        name: "Weather data provided by Visual Crossing",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the chip alone for a verdict with no conditions, and the conditions alone with no verdict", async () => {
    const verdictOnly = await show(kitPage({ ...BARE, verdict: 0 }));
    expect(screen.getByText("Dialed")).toBeVisible();
    expect(screen.queryByText("Feels like · Sky")).not.toBeInTheDocument();
    verdictOnly.unmount();

    await show(kitPage({ ...BARE, conditions: CONDITIONS }));
    expect(screen.getByText("Feels like · Sky")).toBeVisible();
    expect(
      document.querySelector('[data-part="verdict-chip"]'),
    ).not.toBeInTheDocument();
  });

  it("gives THE KIT with a linked piece opening its product in a new tab, and no caption (D-167)", async () => {
    await show(kitPage(KIT));

    expect(document.querySelector('[data-part="caption"]')).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "The kit · 2" }),
    ).toBeVisible();
    const linked = link("Tracksmith Brighton Base Layer");
    expect(linked).toHaveAttribute("href", "https://tracksmith.com/brighton");
    expect(linked).toHaveAttribute("target", "_blank");
    expect(linked).toHaveAttribute("rel", "ugc nofollow noopener");
    expect(screen.getByText("tracksmith.com")).toBeVisible();
    // Unlinked is plain, in ink.
    expect(screen.getByText("Old black beanie").tagName).toBe("SPAN");
    expect(screen.getByText("Old black beanie")).toHaveClass("text-ink");
    expect(
      screen.queryByRole("link", { name: "Old black beanie" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("L/S crew")).toHaveClass("text-mono-xs");
    expect(screen.getByText("Headwear")).toBeVisible();
  });

  it("lists two pieces of the same name as two pieces", async () => {
    const errors = vi.spyOn(console, "error");
    const twin = { name: "Grey tee", model: "Grey tee", kind: "Top" };
    await show(kitPage({ ...BARE, pieces: [twin, twin] }));

    expect(screen.getAllByText("Grey tee")).toHaveLength(2);
    // React says so when two rows share a key.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("credits Visual Crossing only for its own reading", async () => {
    const credited = await show(kitPage(KIT));
    expect(link("Weather data provided by Visual Crossing")).toHaveAttribute(
      "href",
      "https://www.visualcrossing.com/",
    );
    credited.unmount();

    await show(
      kitPage({
        ...KIT,
        conditions: {
          feelsLike: "38°",
          sky: "damp",
          said: "38 degrees, damp",
          isProviders: false,
        },
      }),
    );
    expect(
      screen.queryByRole("link", {
        name: "Weather data provided by Visual Crossing",
      }),
    ).not.toBeInTheDocument();
  });

  it("asks a stranger in: the pitch, an invite, and a code", async () => {
    await show(kitPage(KIT));

    expect(
      screen.getByRole("heading", { level: 2, name: "Wear what worked." }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "dialed.run keeps what you wore on each run and how it felt, then tells you what to wear when that weather comes round again.",
      ),
    ).toBeVisible();
    const invite = within(
      document.querySelector<HTMLElement>("[data-part='invite']") ??
        document.body,
    );
    const ask = invite.getByRole("link", { name: "Request access" });
    expect(ask).toHaveAttribute("href", "https://dialed.run/invite");
    expect(ask).toHaveClass("bg-ink", "rounded-pill");
    // R55·176: the cross-link is quiet text with a bold ink underlined link.
    const create = invite.getByRole("link", { name: "Create an account" });
    expect(create).toHaveAttribute("href", "/join");
    expect(create).toHaveClass("font-bold", "text-ink", "underline");
    expect(create.parentElement).toHaveTextContent(
      /^Have a code\? Create an account$/u,
    );
    expect(create.parentElement).toHaveClass("text-body", "text-quiet");
    expect(screen.queryByText(/Join/u)).toBeNull();
  });

  it("wears the one signed-out frame: Log in, Request access, the wordmark home (R55·176)", async () => {
    await show(kitPage(KIT));

    const bar = document.querySelector<HTMLElement>("[data-part='top-bar']");
    // Paper with a hairline foot now, as every signed-out page.
    expect(bar).toHaveAttribute("data-slot", "landing-bar");
    expect(bar).not.toHaveAttribute("data-ground");
    expect(link("dialed.run home")).toHaveAttribute("href", "/");
    expect(link("dialed.run home")).toHaveTextContent(
      /^\[dialed\.run\]dialed\.run$/u,
    );
    expect(
      within(bar ?? document.body)
        .getAllByRole("link")
        .map((each) => [each.textContent, each.getAttribute("href")]),
    ).toStrictEqual([
      ["[dialed.run]dialed.run", "/"],
      ["Log in", "/auth/login"],
      ["Request access", "/account/request-access"],
    ]);
    expect(
      screen.queryByRole("link", { name: "Open in the app" }),
    ).not.toBeInTheDocument();
  });

  it("ends its body with Report this kit, the link filled in, then the frame's five links", async () => {
    await show(kitPage(KIT));

    expect(link("Report this kit")).toHaveAttribute(
      "href",
      `/takedown?location=${encodeURIComponent(KIT_URL)}`,
    );
    const foot = document.querySelector('[data-part="public-foot"]');
    // At the foot of the body (R55·176), last in the page's main.
    expect(foot?.parentElement?.tagName).toBe("MAIN");
    expect(foot?.parentElement?.lastElementChild).toBe(foot);
    expect(foot).toHaveClass("px-6", "pb-8", "text-small", "desk:col-start-1");
    expect(link("Report this kit")).toHaveClass(
      "target",
      "text-muted",
      "underline",
    );
    const footer = document.querySelector<HTMLElement>(
      "[data-part='legal-footer']",
    );
    expect(
      within(footer ?? document.body)
        .getAllByRole("link")
        .map((each) => each.textContent),
    ).toStrictEqual([
      "Privacy",
      "Terms",
      "Copyright",
      "Open source",
      "Report an intimate image",
    ]);
  });

  it("offers no Useful, follow or comment", async () => {
    await show(kitPage(KIT));

    for (const name of [/useful/iu, /follow/iu, /comment/iu]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("marks the page hydrated, as every screen does", async () => {
    await show(kitPage(KIT));

    expect(document.documentElement.dataset.hydrated).toBe("true");
  });
});

describe("the public kit, once the browser knows who is looking", () => {
  it("is the signed-out page on the server, whoever asks", async () => {
    // What the edge keeps: rendered before any effect, so a signed-in
    // answer cannot reach it.
    const html = await firstPaint(kitPage(KIT, SIGNED_IN));

    expect(html).toBe(await firstPaint(kitPage(KIT, SIGNED_OUT)));
    expect(html).toContain("Log in");
    expect(html).toContain("Wear what worked.");
    expect(html).not.toContain("Open in the app");
  });

  it("swaps Log in for Open in the app, and drops the invite, for a runner", async () => {
    const ask = vi.fn(SIGNED_IN);
    await show(kitPage(KIT, ask));

    expect(
      await screen.findByRole("link", { name: "Open in the app" }),
    ).toHaveAttribute("href", `/feed/entry/${ID}`);
    expect(link("Open in the app")).toHaveClass(
      "rounded-pill",
      "bg-ink",
      "text-ground",
    );
    // One slot, never both (round 42 #90).
    const bar = document.querySelector<HTMLElement>("[data-part='top-bar']");
    expect(within(bar ?? document.body).getAllByRole("link")).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: "Log in" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Wear what worked." }),
    ).not.toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);
    // Nothing else changes.
    expect(link("Report this kit")).toBeVisible();
  });

  it("stays signed out when the answer is nobody, or no answer comes", async () => {
    const nobody = vi.fn(SIGNED_OUT);
    const first = await show(kitPage(KIT, nobody));
    await waitFor(() => {
      expect(nobody).toHaveBeenCalled();
    });
    expect(link("Log in")).toBeVisible();
    first.unmount();

    const failing = vi.fn(() => Promise.reject(new Error("offline")));
    await show(kitPage(KIT, failing));
    await waitFor(() => {
      expect(failing).toHaveBeenCalled();
    });
    expect(link("Log in")).toBeVisible();
    expect(
      within(
        document.querySelector<HTMLElement>("[data-part='invite']") ??
          document.body,
      ).getByRole("link", { name: "Request access" }),
    ).toBeVisible();
  });
});

describe("not public (round 41 #86f)", () => {
  it("says what public pages are, never what this one was", async () => {
    await show(
      <NotPublicPage page={{ entryId: ID }} askSignedIn={SIGNED_OUT} />,
    );

    expect(screen.getByText("404")).toHaveClass("text-mono-xs", "text-muted");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Nothing to see at this link",
      }),
    ).toHaveClass("font-display", "text-display", "uppercase");
    expect(
      screen.getByText(
        "A kit shows here only while the runner who logged it keeps it public.",
      ),
    ).toBeVisible();
    expect(link("What is dialed.run?")).toHaveAttribute(
      "href",
      "https://dialed.run",
    );
    expect(link("Log in")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Report this kit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Wear what worked." }),
    ).not.toBeInTheDocument();
  });

  it("offers a runner a look in the app, at the app's own page of the kit", async () => {
    await show(
      <NotPublicPage page={{ entryId: ID }} askSignedIn={SIGNED_IN} />,
    );

    expect(
      await screen.findByRole("link", { name: "Look in the app" }),
    ).toHaveAttribute("href", `/feed/entry/${ID}`);
  });

  it("is the same page for every viewer: the server sends it signed out", async () => {
    const html = await firstPaint(
      <NotPublicPage page={{ entryId: ID }} askSignedIn={SIGNED_IN} />,
    );

    expect(html).toBe(
      await firstPaint(
        <NotPublicPage page={{ entryId: ID }} askSignedIn={SIGNED_OUT} />,
      ),
    );
    expect(html).toContain("Nothing to see at this link");
    expect(html).not.toContain("Look in the app");
  });
});

describe("useSignedInAfterLoad", () => {
  it("asks again when it is handed a new question", async () => {
    const { result, rerender } = renderHook(
      ({ ask }: { ask: AskSignedIn }) => useSignedInAfterLoad(ask),
      { initialProps: { ask: SIGNED_OUT } },
    );
    await waitFor(() => {
      expect(result.current).toStrictEqual({ isSignedIn: false });
    });

    rerender({ ask: SIGNED_IN });

    await waitFor(() => {
      expect(result.current).toStrictEqual({ isSignedIn: true });
    });
  });
});

describe("the public kit's photos (D-153, design 163 step 8)", () => {
  const PHOTOS = [
    "https://photos.dialed.run/0a1b2c3d",
    "https://photos.dialed.run/4e5f6a7b",
  ];

  it("shows each from the public bucket, in order, under who and which day and over the conditions", async () => {
    await show(kitPage({ ...KIT, photos: PHOTOS }));

    const pager = document.querySelector('[data-part="photo"]');
    const images = [...(pager?.querySelectorAll("img") ?? [])];
    expect(images.map((image) => image.getAttribute("src"))).toStrictEqual(
      PHOTOS,
    );
    expect(screen.getByText("1 / 2")).toBeVisible();
    // Under the header and over the conditions: round 41's order.
    const parts = [
      ...document.querySelectorAll<HTMLElement>(
        'h1, [data-part="photo"], [data-part="conditions"]',
      ),
    ].map((part) => part.dataset.part ?? part.tagName);
    expect(parts).toStrictEqual(["H1", "photo", "conditions"]);
    // Nobody owns anything on the open web's page: no delete.
    expect(screen.queryByRole("button", { name: /delete/iu })).toBeNull();
  });

  it("shows no photo for a kit with none", async () => {
    await show(kitPage(KIT));

    expect(document.querySelector('[data-part="photo"]')).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });
});
