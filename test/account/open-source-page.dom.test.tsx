import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { OpenSourcePage } from "../../src/modules/account/components/OpenSourcePage";
import { parseLegalDoc } from "../../src/modules/account/legal-markdown";
import type { LicenceGroup } from "../../src/modules/account/open-source-search";

/**
 * `/open-source` (plan C9; round 29 #9): the thank-you, the groups with the
 * type first, each licence's text once, three rows then Show all, the
 * search, and the third-party notices.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/open-source"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const TYPE: LicenceGroup = {
  id: "sil-open-font-license-11",
  name: "SIL Open Font License 1.1",
  isType: true,
  text: "SIL OPEN FONT LICENSE Version 1.1",
  pieces: [
    {
      name: "Archivo, Archivo Black",
      copyright: "2020 The Archivo Project Authors",
      project: "https://github.com/Omnibus-Type/Archivo",
    },
    { name: "IBM Plex Mono", copyright: "2017 IBM Corp." },
  ],
};

const MIT: LicenceGroup = {
  id: "mit",
  name: "MIT",
  isType: false,
  text: "Permission is hereby granted, free of charge",
  pieces: [
    {
      name: "react",
      version: "19.2.0",
      copyright: "Meta Platforms, Inc. and affiliates",
      project: "https://react.dev/",
    },
    { name: "zod", version: "4.5.4", copyright: "Colin McDonnell" },
    { name: "clsx", version: "2.1.1" },
    { name: "react-dom", version: "19.2.0" },
    {
      name: "seroval",
      version: "1.0.0",
      text: "MIT, with a clause of its own",
    },
  ],
};

const APACHE: LicenceGroup = {
  id: "apache-20",
  name: "Apache 2.0",
  isType: false,
  text: undefined,
  pieces: [
    { name: "photon", version: "0.4.0", notice: "This product includes…" },
    { name: "detect-libc", version: "2.0.0" },
    { name: "typescript", version: "6.0.0" },
  ],
};

const NOTICES = parseLegalDoc(
  [
    "# Third-party notices",
    "",
    "Material this repository vendors.",
    "",
    "## Weather data",
    "",
    "- **Source:** Visual Crossing Corporation.",
    "",
    "## Climate zones",
    "",
    "Köppen-Geiger maps.",
  ].join("\n"),
);

function bell({
  unreadCount,
  verdictsWaiting,
}: Readonly<{ unreadCount: number; verdictsWaiting: number }>) {
  return (
    <span data-testid="bell">{`${String(unreadCount)}/${String(verdictsWaiting)}`}</span>
  );
}

function renderPage(groups: readonly LicenceGroup[] = [TYPE, MIT, APACHE]) {
  return renderWithRouter(
    <OpenSourcePage
      groups={groups}
      notices={NOTICES}
      bellState={undefined}
      bell={bell}
    />,
  );
}

function section(name: string) {
  const heading = screen.getByRole("heading", { level: 2, name });
  const found = heading.closest("section");
  if (found === null) throw new Error(`no section for ${name}`);
  return found;
}

function rowNames(name: string) {
  return within(section(name))
    .getAllByRole("listitem")
    .map((row) => row.querySelector(".font-semibold")?.textContent);
}

const search = () => screen.getByRole("searchbox", { name: "Find a package" });

describe("OpenSourcePage", () => {
  it("reads in the signed-out shell for a signed-out reader and the signed-in one, with the bell, otherwise", async () => {
    const { unmount } = await renderPage();
    expect(document.querySelector("[data-slot='landing-bar']")).not.toBeNull();
    expect(screen.queryByTestId("bell")).toBeNull();
    unmount();
    await renderWithRouter(
      <OpenSourcePage
        groups={[MIT]}
        notices={NOTICES}
        bellState={{ unreadCount: 4, verdictsWaiting: 1 }}
        bell={bell}
      />,
    );
    expect(document.querySelector("[data-slot='tab-bar']")).not.toBeNull();
    expect(screen.getAllByTestId("bell")[0]).toHaveTextContent(/^4\/1$/u);
  });

  it("thanks people: the kicker, the heading, and a lead that counts every piece", async () => {
    await renderPage();
    const kicker = within(screen.getByRole("main")).getByText("Open source");
    expect(kicker).toHaveClass("text-mono-xs", "uppercase", "text-muted");
    expect(
      screen.getByRole("heading", { level: 1, name: "Built with thanks" }),
    ).toHaveClass("font-display", "text-display", "uppercase");
    expect(
      screen.getByText(
        "dialed.run runs on code and type that people chose to give away. Here are all 10 pieces, grouped by licence, with a link to each project.",
      ).tagName,
    ).toBe("P");
  });

  it("lists every group with its count in the contents, then the notices", async () => {
    await renderPage();
    const contents = screen.getByRole("navigation", { name: "Contents" });
    const entries = within(contents).getAllByRole("listitem");
    expect(
      entries.map((entry) => [
        within(entry).getByRole("link").textContent,
        within(entry).getByRole("link").getAttribute("href"),
        entry.querySelector(".text-mono-md")?.textContent,
      ]),
    ).toEqual([
      ["SIL Open Font License 1.1", "#sil-open-font-license-11", "2"],
      ["MIT", "#mit", "5"],
      ["Apache 2.0", "#apache-20", "3"],
      ["Third-party notices", "#third-party-notices", undefined],
    ]);
  });

  it("puts the type first, with its line, and counts it as type", async () => {
    await renderPage();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Contents",
      "SIL Open Font License 1.1",
      "MIT",
      "Apache 2.0",
      "Third-party notices",
    ]);
    const type = section("SIL Open Font License 1.1");
    expect(within(type).getByText("2 · Type")).toHaveClass("text-mono-xs");
    expect(
      within(type).getByText("The two typefaces you read everything in."),
    ).toBeInTheDocument();
    const mit = section("MIT");
    expect(within(mit).getByText("5")).toHaveClass("text-mono-xs");
    expect(
      within(mit).queryByText("The two typefaces you read everything in."),
    ).toBeNull();
  });

  it("prints each group's licence once, closed until asked for, and offers none where there is no text", async () => {
    await renderPage();
    const mit = section("MIT");
    const read = within(mit).getByText("Read the MIT licence");
    expect(read.tagName).toBe("SUMMARY");
    expect(read).toHaveClass("target", "underline");
    const details = read.closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details?.querySelector("pre")).toHaveTextContent(
      "Permission is hereby granted, free of charge",
    );
    // Above the rows.
    expect(details?.nextElementSibling?.tagName).toBe("UL");
    expect(
      within(section("SIL Open Font License 1.1")).getByText(
        "Read the licence text",
      ),
    ).toBeInTheDocument();
    expect(within(section("Apache 2.0")).queryByText(/^Read the/u)).toBeNull();
  });

  it("draws a row as its name, version, Project link and copyright line", async () => {
    await renderPage();
    const [react, , clsx] = within(section("MIT")).getAllByRole("listitem");
    if (react === undefined || clsx === undefined) throw new Error("no rows");
    expect(within(react).getByText("react")).toHaveClass("font-semibold");
    expect(within(react).getByText("19.2.0")).toHaveClass("text-mono-md");
    const project = within(react).getByRole("link", { name: "Project" });
    expect(project).toHaveAttribute("href", "https://react.dev/");
    expect(project).toHaveClass("target", "underline");
    expect(
      within(react).getByText("© Meta Platforms, Inc. and affiliates"),
    ).toHaveClass("text-small", "text-muted");
    // Nothing on record, nothing drawn.
    expect(within(clsx).queryByText("Project")).toBeNull();
    expect(within(clsx).queryByText(/^©/u)).toBeNull();
    expect(clsx.querySelector("details")).toBeNull();
    const plex = within(section("SIL Open Font License 1.1")).getAllByRole(
      "listitem",
    )[1];
    expect(plex?.querySelector(".text-mono-md")).toBeNull();
  });

  it("shows a group's first three rows, and all of them after Show all", async () => {
    const user = userEvent.setup();
    await renderPage();
    expect(rowNames("MIT")).toEqual(["react", "zod", "clsx"]);
    const showAll = within(section("MIT")).getByRole("button", {
      name: "Show all 5",
    });
    expect(showAll).toHaveClass("target", "underline");
    // Every row keyed by its own name and version: React says nothing.
    const errors = vi.spyOn(console, "error");
    await user.click(showAll);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    expect(rowNames("MIT")).toEqual([
      "react",
      "zod",
      "clsx",
      "react-dom",
      "seroval",
    ]);
    expect(within(section("MIT")).queryByRole("button")).toBeNull();
    // Three is all of Apache's, so there is nothing to show.
    expect(within(section("Apache 2.0")).queryByRole("button")).toBeNull();
  });

  it("gives a row its NOTICE and its own licence text, each closed until asked for", async () => {
    const user = userEvent.setup();
    await renderPage();
    const photon = within(section("Apache 2.0")).getAllByRole("listitem")[0];
    const notice = within(photon ?? document.body).getByText("Notice");
    expect(notice.tagName).toBe("SUMMARY");
    expect(notice.closest("details")?.querySelector("pre")).toHaveTextContent(
      "This product includes…",
    );
    await user.click(
      within(section("MIT")).getByRole("button", { name: "Show all 5" }),
    );
    const seroval = within(section("MIT")).getAllByRole("listitem")[4];
    const own = within(seroval ?? document.body).getByText("Licence");
    expect(own.closest("details")?.querySelector("pre")).toHaveTextContent(
      "MIT, with a clause of its own",
    );
  });

  it("filters every group by package name as you type, hiding the groups it empties", async () => {
    const user = userEvent.setup();
    await renderPage();
    const field = search();
    expect(field).toHaveAttribute("placeholder", "Name, e.g. date-fns");
    expect(field).toHaveAttribute("type", "search");
    await user.type(field, "Re");
    expect(rowNames("MIT")).toEqual(["react", "react-dom"]);
    expect(screen.queryByRole("heading", { name: "Apache 2.0" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "SIL Open Font License 1.1" }),
    ).toBeNull();
    // The notices are not a group, and stay.
    expect(
      screen.getByRole("heading", { level: 2, name: "Third-party notices" }),
    ).toBeInTheDocument();
    await user.clear(field);
    expect(rowNames("MIT")).toEqual(["react", "zod", "clsx"]);
    expect(
      screen.getByRole("heading", { level: 2, name: "Apache 2.0" }),
    ).toBeInTheDocument();
  });

  it("keeps an opened group open while searching", async () => {
    const user = userEvent.setup();
    await renderPage([
      {
        ...MIT,
        pieces: ["a1", "a2", "a3", "a4", "a5"].map((name) => ({ name })),
      },
    ]);
    await user.type(search(), "a");
    expect(rowNames("MIT")).toEqual(["a1", "a2", "a3"]);
    await user.click(screen.getByRole("button", { name: "Show all 5" }));
    await user.type(search(), "{Backspace}a");
    expect(rowNames("MIT")).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("says so when nothing matches, and only then", async () => {
    const user = userEvent.setup();
    await renderPage();
    expect(screen.queryByText(/^Nothing we ship/u)).toBeNull();
    await user.type(search(), " xyz ");
    expect(screen.getByText("Nothing we ship is called “xyz”.").tagName).toBe(
      "P",
    );
    expect(screen.queryByRole("heading", { name: "MIT" })).toBeNull();
  });

  it("renders the third-party notices' sections, one level down, without the file's preamble", async () => {
    await renderPage();
    const notices = section("Third-party notices");
    expect(notices).toHaveAttribute("aria-labelledby", "third-party-notices");
    expect(
      within(notices)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => [heading.textContent, heading.id]),
    ).toEqual([
      ["Weather data", "weather-data"],
      ["Climate zones", "climate-zones"],
    ]);
    expect(within(notices).getByText("Source:").tagName).toBe("STRONG");
    expect(within(notices).getByText("Köppen-Geiger maps.")).toBeVisible();
    expect(screen.queryByText("Material this repository vendors.")).toBeNull();
    expect(
      within(notices).getByRole("link", { name: "Back to contents" }),
    ).toHaveAttribute("href", "#contents");
  });
});
