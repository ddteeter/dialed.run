import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  NotPublicPage,
  type AskSignedIn,
} from "../../src/modules/feed/components/PublicFrame";
import { PublicProfilePage } from "../../src/modules/feed/components/PublicProfile";
import type { PublicProfile } from "../../src/modules/feed/public-profile-shape";

/**
 * `/@handle` and its not-public twin (round 41 #86d, #86f).
 */

const IDS = [
  "01JABCDEFGHJKMNPQRSTVWXYZ0",
  "01JABCDEFGHJKMNPQRSTVWXYZ1",
  "01JABCDEFGHJKMNPQRSTVWXYZ2",
] as const;

const ROTATION = {
  inUse: [
    { name: "Brighton Base Layer", detail: "L/S crew" },
    { name: "AFO Middle Tight", detail: "Tights" },
  ],
  shoes: [{ name: "Pegasus 41", detail: "412 mi" }],
  retired: [{ name: "Pegasus 40", detail: "508 mi" }],
};

const PROFILE: PublicProfile = {
  handle: "maya_runs",
  kitCount: 12,
  kits: [
    {
      entryId: IDS[0],
      day: "Sat Oct 18",
      conditions: {
        feelsLike: "38°",
        sky: "damp",
        said: "38 degrees, damp",
        isProviders: true,
      },
      verdict: -1,
      distance: { value: "6.2", unit: "mi" },
    },
    {
      entryId: IDS[1],
      day: "Sun Oct 12",
      verdict: 0,
      distance: { value: "13.1", unit: "mi" },
    },
    {
      entryId: IDS[2],
      day: "Sat Sep 27",
      distance: { value: "5.0", unit: "mi" },
    },
  ],
  rotation: ROTATION,
};

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
      stub("/@{$handle}"),
      stub("/kit/$entryId"),
      stub("/feed/u/$handle"),
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

function profilePage(profile: PublicProfile, ask: AskSignedIn = SIGNED_OUT) {
  return (
    <PublicProfilePage
      profile={profile}
      origin="https://dialed.run"
      askSignedIn={ask}
    />
  );
}

function link(name: string | RegExp): HTMLElement {
  return screen.getByRole("link", { name });
}

function part(name: string): HTMLElement | null {
  return document.querySelector(`[data-part="${CSS.escape(name)}"]`);
}

describe("the public profile, signed out", () => {
  it("names the runner in TYPE.display, then Kits with how many", async () => {
    await show(profilePage(PROFILE));

    const handle = screen.getByRole("heading", { level: 1 });
    expect(handle).toHaveTextContent(/^@maya_runs$/u);
    expect(handle).toHaveClass("font-display", "text-display");
    expect(handle).not.toHaveClass("text-title");
    expect(handle).not.toHaveClass("wrap-anywhere");
    const kits = screen.getByRole("heading", { level: 2, name: "Kits 12" });
    expect(kits).toHaveClass("font-display", "text-heading");
    // The count at the row's right, as the boards draw it (#633 A-15).
    expect(kits).toHaveClass("flex", "justify-between");
    expect(within(kits).getByText("12")).toHaveClass("text-mono-md");
  });

  it("breaks the handle only after an underscore, never inside a word (R55·218a)", async () => {
    await show(profilePage(PROFILE));
    const handle = screen.getByRole("heading", { level: 1 });
    // "@maya_" then a break opportunity, then "runs".
    const wbr = handle.querySelector("wbr");
    expect(handle.querySelectorAll("wbr")).toHaveLength(1);
    expect(wbr?.previousSibling?.textContent).toBe("_");
    expect(wbr?.nextSibling?.textContent).toBe("runs");
    expect(handle.firstChild?.textContent).toBe("@");
  });

  it("steps a handle past 17 characters down to TYPE.title (R55·218a)", async () => {
    const at17 = "a_seventeen_chars";
    expect(at17).toHaveLength(17);
    const { unmount } = await show(profilePage({ ...PROFILE, handle: at17 }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "text-display",
    );
    unmount();
    await show(profilePage({ ...PROFILE, handle: `${at17}x` }));
    const longer = screen.getByRole("heading", { level: 1 });
    expect(longer).toHaveClass("m-0", "font-display", "text-title");
    expect(longer).not.toHaveClass("text-display");
    expect(longer.querySelectorAll("wbr")).toHaveLength(2);
  });

  it("lists each kit as a link to its own page: conditions, day and distance, verdict", async () => {
    await show(profilePage(PROFILE));

    const rows = within(part("kits") ?? document.body).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const first = within(rows[0] ?? document.body).getByRole("link");
    expect(first).toHaveAttribute("href", `/kit/${IDS[0]}`);
    expect(first).toHaveTextContent(
      /^38° damp38 degrees, dampSat Oct 18 · 6\.2 miA bit cold$/u,
    );
    // Round 52 #158: the conditions drawn for the eye, said in words.
    expect(within(first).getByText("38 degrees, damp")).toHaveClass("sr-only");
    expect(within(first).getByText("damp").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // The measured word teal, as teal always means measured conditions.
    expect(within(first).getByText("damp")).toHaveClass("text-dialed-text");
    expect(within(first).getByText("Sat Oct 18 · 6.2 mi")).toHaveClass(
      "text-mono-xs",
      "text-muted",
    );
    expect(first.querySelector('[data-part="verdict-chip"]')).toBeVisible();

    // No conditions: the day and distance alone. No verdict: no chip.
    const third = within(rows[2] ?? document.body).getByRole("link");
    expect(third).toHaveTextContent(/^Sat Sep 27 · 5\.0 mi$/u);
    expect(third.querySelector('[data-part="verdict-chip"]')).toBeNull();
    expect(within(rows[1] ?? document.body).getByRole("link")).toHaveAttribute(
      "href",
      `/kit/${IDS[1]}`,
    );
  });

  it("draws each kit's tile as a --tint row on the phone and a square in the desk's 3-up grid", async () => {
    await show(profilePage(PROFILE));

    expect(within(part("kits") ?? document.body).getByRole("list")).toHaveClass(
      "flex-col",
      "desk:grid",
      "desk:grid-cols-3",
      "desk:gap-3",
    );
    const tile = part("kit-tile");
    expect(tile).toHaveClass(
      "size-16",
      "bg-tint",
      "rounded-tile",
      "desk:aspect-square",
      "desk:w-full",
    );
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(link(/Sat Oct 18/u)).toHaveClass(
      "target",
      "grid",
      "grid-cols-[auto_minmax(0,1fr)_auto]",
      "items-center",
      "border-b",
      "desk:grid-cols-[minmax(0,1fr)_auto]",
      "desk:border-b-0",
    );
  });

  it("puts the verdict chip on the conditions' row at the desk, the day under both (#633 A-15)", async () => {
    await show(profilePage(PROFILE));
    const row = link(/Sat Oct 18/u);
    const [tile, conditions, day, chip] = [...row.children];
    expect(tile?.querySelector("[data-part='kit-tile']")).not.toBeNull();
    expect(tile).toHaveClass(
      "row-span-2",
      "desk:col-span-2",
      "desk:row-span-1",
    );
    expect(conditions).toHaveClass(
      "col-start-2",
      "row-start-1",
      "text-body",
      "font-semibold",
      "desk:col-start-1",
      "desk:row-start-2",
    );
    expect(day).toHaveTextContent(/Sat Oct 18/u);
    expect(day).toHaveClass(
      "col-start-2",
      "row-start-2",
      "desk:col-span-2",
      "desk:col-start-1",
      "desk:row-start-3",
    );
    expect(chip?.querySelector("[data-part='verdict-chip']")).not.toBeNull();
    expect(chip).toHaveClass(
      "col-start-3",
      "row-span-2",
      "row-start-1",
      "desk:col-start-2",
      "desk:row-span-1",
      "desk:row-start-2",
    );
  });

  it("shows a kit's public photo in its tile, cropped to the tile's box, and the --tint tile for the rest", async () => {
    const photo = "https://photos.dialed.run/0123456789abcdef0123456789abcdef";
    const profile: PublicProfile = {
      ...PROFILE,
      kits: PROFILE.kits.map((row, index) =>
        index === 1 ? { ...row, photo } : row,
      ),
    };
    expect(await firstPaint(profilePage(profile))).toContain(`src="${photo}"`);

    await show(profilePage(profile));

    const rows = within(part("kits") ?? document.body).getAllByRole("listitem");
    const tiles = rows.map((row) =>
      row.querySelector<HTMLElement>('[data-part="kit-tile"]'),
    );
    expect(tiles.map((tile) => tile?.tagName)).toStrictEqual([
      "SPAN",
      "IMG",
      "SPAN",
    ]);
    const image = tiles[1];
    expect(image).toHaveAttribute("src", photo);
    // Decorative: the row's own words name the kit, and stay its name.
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveClass(
      "size-16",
      "shrink-0",
      "rounded-tile",
      "bg-tint",
      "object-cover",
      "desk:aspect-square",
      "desk:size-auto",
      "desk:w-full",
    );
    expect(link(/Sun Oct 12/u)).toHaveAccessibleName(
      "Sun Oct 12 · 13.1 mi Dialed",
    );
  });

  it("offers the rest with Show {N} more, a plain link to ?all", async () => {
    await show(profilePage(PROFILE));

    expect(link("Show 9 more")).toHaveAttribute("href", "/@maya_runs?all=true");
    expect(link("Show 9 more")).toHaveClass("target", "underline");
  });

  it("offers nothing more once every kit is listed", async () => {
    await show(profilePage({ ...PROFILE, kitCount: 3 }));

    expect(
      screen.queryByRole("link", { name: /more$/u }),
    ).not.toBeInTheDocument();
  });

  it("says when there are no public kits yet", async () => {
    await show(profilePage({ ...PROFILE, kitCount: 0, kits: [] }));

    expect(screen.getByText("No public kits yet.")).toHaveClass(
      "text-body",
      "text-quiet",
    );
    expect(
      within(part("kits") ?? document.body).queryByRole("list"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /more$/u }),
    ).not.toBeInTheDocument();
  });

  it("credits Visual Crossing only when a kit shows its reading", async () => {
    const first = await show(profilePage(PROFILE));
    expect(screen.getByText(/Visual Crossing/u)).toBeVisible();
    first.unmount();

    const [reading, ...rest] = PROFILE.kits;
    await show(
      profilePage({
        ...PROFILE,
        kits: [
          {
            ...reading,
            entryId: IDS[0],
            day: "Sat Oct 18",
            distance: { value: "6.2", unit: "mi" },
            conditions: {
              feelsLike: "38°",
              sky: "damp",
              said: "38 degrees, damp",
              isProviders: false,
            },
          },
          ...rest,
        ],
      }),
    );
    expect(screen.queryByText(/Visual Crossing/u)).not.toBeInTheDocument();
    // Asked of every row, those with no conditions too, and the page drew.
    expect(
      within(part("kits") ?? document.body).getAllByRole("listitem"),
    ).toHaveLength(3);
  });

  it("shows the rotation in the rail: in use with types, shoes with mileage, retired struck through", async () => {
    await show(profilePage(PROFILE));

    const rail = part("rail");
    expect(rail).toHaveClass("desk:row-span-2", "px-6");
    const rotation = within(rail ?? document.body);
    expect(
      rotation.getByRole("heading", { level: 2, name: "Rotation" }),
    ).toHaveClass("font-display", "text-heading");
    expect(
      rotation.getByRole("heading", { level: 3, name: "In use · 2" }),
    ).toBeVisible();
    expect(
      rotation.getByRole("heading", { level: 3, name: "Shoes · 1" }),
    ).toBeVisible();
    expect(
      rotation.getByRole("heading", { level: 3, name: "Retired · 1" }),
    ).toBeVisible();
    const pegasus = rotation.getByText("Pegasus 41").closest("li");
    expect(pegasus).toHaveTextContent(/^Pegasus 41412 mi$/u);
    // Mileage in MONO caps, "412 MI" (round 42 #91).
    expect(rotation.getByText("412 mi")).toHaveClass(
      "font-mono",
      "text-mono-xs",
      "uppercase",
    );
    expect(pegasus).toHaveClass("text-ink");
    expect(pegasus).not.toHaveClass("line-through");
    expect(rotation.getByText("Tights")).toHaveClass("text-mono-xs");
    // Retired: the row --quiet, the name alone struck (N2-19); the
    // mileage and type stay readable, as the board draws them.
    const retired = rotation.getByText("Pegasus 40");
    expect(retired).toHaveClass("line-through");
    expect(retired.closest("li")).toHaveClass("text-quiet");
    expect(retired.closest("li")).not.toHaveClass("line-through");
    expect(retired.nextElementSibling).not.toHaveClass("line-through");
    // A piece never links to its runs.
    expect(rotation.queryAllByRole("link")).toHaveLength(0);
  });

  it("lists two pieces of the same name as two pieces", async () => {
    const errors = vi.spyOn(console, "error");
    const twin = { name: "Grey tee", detail: "Tee" };
    await show(
      profilePage({
        ...PROFILE,
        rotation: { ...ROTATION, inUse: [twin, twin] },
      }),
    );

    expect(screen.getAllByText("Grey tee")).toHaveLength(2);
    // React says so when two rows share a key.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("leaves out a rotation group with nothing in it", async () => {
    await show(
      profilePage({ ...PROFILE, rotation: { ...ROTATION, retired: [] } }),
    );

    expect(
      screen.queryByRole("heading", { name: /^Retired/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shoes · 1" })).toBeVisible();
  });

  it("has no Rotation, and no gap, when every group is empty (round 42 #91)", async () => {
    await show(
      profilePage({
        ...PROFILE,
        rotation: { inUse: [], shoes: [], retired: [] },
      }),
    );

    expect(
      screen.queryByRole("heading", { name: "Rotation" }),
    ).not.toBeInTheDocument();
    expect(part("rail")).toBeNull();
    expect(screen.getByRole("main")).not.toHaveClass("desk:grid");
  });

  it("keeps the Rotation while any one group has a piece", async () => {
    for (const rotation of [
      { inUse: ROTATION.inUse, shoes: [], retired: [] },
      { inUse: [], shoes: ROTATION.shoes, retired: [] },
      { inUse: [], shoes: [], retired: ROTATION.retired },
    ]) {
      const { unmount } = await show(profilePage({ ...PROFILE, rotation }));
      expect(screen.getByRole("heading", { name: "Rotation" })).toBeVisible();
      unmount();
    }
  });

  it("sits in DS1's columns at the desk while it has a rail", async () => {
    await show(profilePage(PROFILE));

    expect(screen.getByRole("main")).toHaveClass(
      "max-w-column",
      "desk:grid",
      "desk:max-w-page",
      "desk:grid-cols-[minmax(0,var(--container-column))_minmax(0,1fr)]",
      // Row 1 is the column's own height; the rail's extra height goes to
      // row 2, so the pitch follows the kits instead of a hole (N2-17).
      "desk:grid-rows-[auto_1fr]",
    );
  });

  it("is the column alone with no Rotation, and no gap, while the closet is not shown", async () => {
    await show(
      profilePage({
        handle: PROFILE.handle,
        kitCount: PROFILE.kitCount,
        kits: PROFILE.kits,
      }),
    );

    expect(
      screen.queryByRole("heading", { name: "Rotation" }),
    ).not.toBeInTheDocument();
    expect(part("rail")).toBeNull();
    expect(screen.getByRole("main")).toHaveClass("max-w-column");
    expect(screen.getByRole("main")).not.toHaveClass("desk:grid");
    expect(screen.getByRole("main")).not.toHaveClass("desk:max-w-page");
  });

  it("closes with the invite, after the rail on the phone and under the kits at the desk", async () => {
    await show(profilePage(PROFILE));

    const invite = part("invite");
    expect(invite?.parentElement).toHaveClass("desk:col-start-1", "px-6");
    // The invite closes the page; only the page's own Report link follows.
    expect(part("public-foot")?.previousElementSibling).toBe(
      invite?.parentElement,
    );
    expect(
      within(invite ?? document.body).getByRole("link", {
        name: "Request access",
      }),
    ).toBeVisible();
  });

  it("ends its body with Report this profile, the link filled in", async () => {
    await show(profilePage(PROFILE));

    const foot = within(part("public-foot") ?? document.body);
    const links = foot.getAllByRole("link");
    expect(links.map((each) => each.textContent)).toStrictEqual([
      "Report this profile",
    ]);
    expect(screen.getByRole("main").lastElementChild).toBe(part("public-foot"));
    expect(links[0]).toHaveAttribute(
      "href",
      `/takedown?location=${encodeURIComponent("https://dialed.run/@maya_runs")}`,
    );
  });

  it("offers no follow, and marks the page hydrated", async () => {
    await show(profilePage(PROFILE));

    expect(
      screen.queryByRole("button", { name: /follow/iu }),
    ).not.toBeInTheDocument();
    expect(document.documentElement.dataset.hydrated).toBe("true");
  });
});

describe("the public profile, once the browser knows who is looking", () => {
  it("is the signed-out page on the server, whoever asks", async () => {
    const html = await firstPaint(profilePage(PROFILE, SIGNED_IN));

    expect(html).toBe(await firstPaint(profilePage(PROFILE, SIGNED_OUT)));
    expect(html).toContain("Log in");
    expect(html).not.toContain("Open in the app");
  });

  it("swaps Log in for Open in the app, at H, and drops the invite, for a runner", async () => {
    await show(profilePage(PROFILE, SIGNED_IN));

    expect(
      await screen.findByRole("link", { name: "Open in the app" }),
    ).toHaveAttribute("href", "/feed/u/maya_runs");
    expect(link("Open in the app")).toHaveClass("bg-ink", "text-ground");
    expect(part("invite")).toBeNull();
    // Nothing closes the page for a runner: the rail, then the Report link.
    expect(part("public-foot")?.previousElementSibling).toBe(part("rail"));
    expect(link("Report this profile")).toBeVisible();
    // The way into the app takes Log in's and Request access's place.
    const bar = within(part("top-bar") ?? document.body);
    expect(bar.queryByRole("link", { name: "Log in" })).toBeNull();
    expect(bar.queryByRole("link", { name: "Request access" })).toBeNull();
    expect(link("Open in the app")).toHaveAttribute("data-part", "bar-actions");
  });
});

describe("not public (round 41 #86f)", () => {
  it("says what public profiles are, and never echoes the handle", async () => {
    const html = await firstPaint(
      <NotPublicPage page={{ handle: "maya_runs" }} askSignedIn={SIGNED_OUT} />,
    );

    expect(html).toContain("Nothing to see at this link");
    expect(html).toContain(
      "A profile shows here only when its runner makes it public.",
    );
    expect(html).not.toContain("maya_runs");
    expect(html).toBe(
      await firstPaint(
        <NotPublicPage
          page={{ handle: "someone_else" }}
          askSignedIn={SIGNED_IN}
        />,
      ),
    );
  });

  it("offers a runner a look in the app, at H for the same handle", async () => {
    await show(
      <NotPublicPage page={{ handle: "maya_runs" }} askSignedIn={SIGNED_IN} />,
    );

    expect(
      await screen.findByRole("link", { name: "Look in the app" }),
    ).toHaveAttribute("href", "/feed/u/maya_runs");
    expect(screen.getByText("404")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Report this profile" }),
    ).not.toBeInTheDocument();
  });

  it("stays signed out when nobody is", async () => {
    const ask = vi.fn(SIGNED_OUT);
    await show(
      <NotPublicPage page={{ handle: "maya_runs" }} askSignedIn={ask} />,
    );

    await waitFor(() => {
      expect(ask).toHaveBeenCalled();
    });
    expect(link("Log in")).toBeVisible();
  });
});
