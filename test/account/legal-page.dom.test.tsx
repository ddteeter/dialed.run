import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { LegalPage } from "../../src/modules/account/terms/components/LegalPage";
import { parseLegalDoc } from "../../src/modules/account/terms/legal-markdown";

/**
 * The reading page (ACC-13; round 26 #14, round 27 #5): contract type,
 * contents that link every H2, "Back to contents" closing each section, and the
 * shell that fits the reader.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/privacy"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const DOC = parseLegalDoc(
  [
    "# Privacy policy",
    "",
    "Before any section.",
    "",
    "## Who we are",
    "",
    "We are **dialed.run**, reached at `hello@dialed.run`.",
    "",
    "### Contact",
    "",
    "- Write to [us](mailto:hello@dialed.run).",
    "- Or read [your choices](#your-choices).",
    "",
    "## Your choices",
    "",
    "> A note.",
    "",
    "2. Second step.",
    "3. Third step.",
    "",
    "| What | How long |",
    "| ---- | -------- |",
    "| Runs | Kept     |",
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

describe("LegalPage", () => {
  it("reads in the signed-out shell for a signed-out reader", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    expect(document.querySelector("[data-slot='landing-bar']")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot='tab-bar']")).toBeNull();
    expect(screen.queryByTestId("bell")).toBeNull();
    // The signed-out frame leaves the page's main to the page.
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("reads in the signed-in shell, with the bell's counts, for a signed-in reader", async () => {
    await renderWithRouter(
      <LegalPage
        slug="privacy"
        doc={DOC}
        bellState={{ unreadCount: 3, verdictsWaiting: 2 }}
        bell={bell}
      />,
    );
    expect(document.querySelector("[data-slot='tab-bar']")).not.toBeNull();
    expect(document.querySelector("[data-slot='landing-bar']")).toBeNull();
    expect(screen.getAllByTestId("bell")[0]).toHaveTextContent(/^3\/2$/u);
    // Below 720 the bell ends the title's row, the page's first (R57·256).
    const seat = within(firstRow() as HTMLElement).getByTestId("bell");
    expect(seat.closest("[data-slot='notification-bell']")).toHaveClass(
      "wide:hidden",
    );
    expect(firstRow().lastElementChild).toContainElement(seat);
    // One first row and one seat: no empty kicker row above the title.
    expect(
      document.querySelectorAll("[data-part='reading-first-row']"),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll("header [data-slot='notification-bell']"),
    ).toHaveLength(1);
    expect(firstRow()).toHaveClass("flex", "items-center", "justify-between");
    // The shell's main is the page's one: the frame brings none of its own.
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("titles the page and lists every H2 in the contents, linked to its id", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy policy" }),
    ).toHaveClass("font-display", "text-display", "uppercase");
    // No kicker above it: `/open-source`'s is its own.
    expect(
      screen.getByRole("heading", { level: 1 }).parentElement?.children,
    ).toHaveLength(1);
    const contents = screen.getByRole("navigation", { name: "Contents" });
    expect(contents).toHaveAttribute("id", "contents");
    // Sticky only at the desk; on the phone it is a plain list.
    expect(contents).toHaveClass("desk:sticky", "desk:col-start-1");
    expect(contents).not.toHaveClass("sticky");
    expect(within(contents).getByText("Contents")).toHaveClass("text-mono-xs");
    const links = within(contents).getAllByRole("link");
    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Who we are", "#who-we-are"],
      ["Your choices", "#your-choices"],
    ]);
    for (const link of links) expect(link).toHaveClass("underline");
  });

  it("gives every H2 its id and closes its section with Back to contents", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Who we are",
    });
    expect(heading).toHaveAttribute("id", "who-we-are");
    const section = heading.closest("section");
    expect(section).toHaveAttribute("aria-labelledby", "who-we-are");
    const back = within(section ?? document.body).getAllByRole("link", {
      name: "Back to contents",
    });
    expect(back).toHaveLength(1);
    expect(back[0]).toHaveAttribute("href", "#contents");
    // Round 28 #16: below the desk only, where the contents sit above.
    expect(back[0]).toHaveClass("text-small", "underline", "desk:hidden");
    // The last thing in the section.
    expect(section?.lastElementChild).toBe(back[0]);
    expect(
      screen.getAllByRole("link", { name: "Back to contents" }),
    ).toHaveLength(2);
  });

  it("keeps what comes before the first H2 out of any section", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    const before = screen.getByText("Before any section.");
    expect(before.tagName).toBe("P");
    expect(before.closest("section")).toBeNull();
    expect(before.closest("article")).toHaveClass("max-w-column", "text-lead");
  });

  it("puts each H2's blocks in its own section, and no other", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    const sectionOf = (name: string) =>
      screen.getByRole("heading", { level: 2, name }).closest("section");
    const first = sectionOf("Who we are");
    const second = sectionOf("Your choices");
    expect(first).toContainElement(
      screen.getByText("dialed.run", { selector: "strong" }),
    );
    expect(first).toContainElement(screen.getByText("us"));
    expect(second).toContainElement(screen.getByText("A note."));
    expect(second).toContainElement(screen.getByRole("table"));
    expect(first).not.toContainElement(screen.getByText("A note."));
  });

  it("renders bold, code, links, the H3, lists, quotes and tables", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    expect(screen.getByText("dialed.run", { selector: "strong" }).tagName).toBe(
      "STRONG",
    );
    expect(screen.getByText("hello@dialed.run")).toHaveClass("text-mono-md");
    expect(screen.getByText("hello@dialed.run").closest("code")).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 3, name: "Contact" }),
    ).toBeInTheDocument();
    const list = screen.getByText("us").closest("ul");
    expect(list).toHaveClass("list-disc");
    if (list === null) throw new Error("no list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    const us = screen.getByRole("link", { name: "us" });
    expect(us).toHaveAttribute("href", "mailto:hello@dialed.run");
    expect(us).toHaveClass("underline");
    expect(screen.getByRole("link", { name: "your choices" })).toHaveAttribute(
      "href",
      "#your-choices",
    );
    expect(screen.getByText("A note.").tagName).toBe("BLOCKQUOTE");
    const numbered = screen.getByText("Second step.").closest("ol");
    expect(numbered).toHaveAttribute("start", "2");
    expect(numbered).toHaveClass("list-decimal");
    if (numbered === null) throw new Error("no numbered list");
    expect(
      within(numbered)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Second step.", "Third step."]);
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["What", "How long"]);
    expect(within(table).getAllByRole("columnheader")[0]).toHaveAttribute(
      "scope",
      "col",
    );
    expect(
      within(table)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["Runs", "Kept"]);
  });
});

/**
 * A text written as the owner's drafts are (R55 · 220–224): the banner
 * before the title, the bracketed name, owner's notes, bare addresses, a
 * list with bold lead-ins and a table of more than two columns.
 */
const DRAFT = parseLegalDoc(
  [
    "> **DRAFT: not reviewed by a lawyer.** Written from the code on `main`,",
    "> for the owner to edit.",
    "",
    "# [dialed.run] privacy policy",
    "",
    "Effective: [OWNER: the day the first invite is sent]",
    "",
    "> A quote that is not the banner.",
    "",
    "## Who can use [dialed.run]",
    "",
    "[dialed.run] is run by us. Write to hello@dialed.run, or (desk@dialed.run).",
    "Also a@x.run; b@x.run: c@x.run. Not @x.run, d@.run or e@run.",
    "Plain **bold** in a paragraph.",
    "",
    "- **Account email.** Sent from [us](mailto:hello@dialed.run), not a@b.",
    "- Plain item.",
    "- Then **bold** inside.",
    "",
    "### Processors",
    "",
    "| Service | Company | Role |",
    "| ------- | ------- | ---- |",
    "| Sentry  | Functional Software | Processor |",
    "| OpenAI  | OpenAI OpCo | Processor |",
    "| Short   | Only |",
  ].join("\n"),
);

/**
 * The page's first row: a legal text has no kicker, so it is the title's,
 * which the phone bell ends for a signed-in reader (R57·256).
 */
function firstRow(): Element {
  const row = screen.getByRole("heading", { level: 1 }).parentElement;
  if (row === null) throw new Error("no first row");
  expect(row).toHaveAttribute("data-part", "reading-first-row");
  return row;
}

async function renderDraft(slug: "privacy" | "terms" | "copyright") {
  return renderWithRouter(
    <LegalPage slug={slug} doc={DRAFT} bellState={undefined} bell={bell} />,
  );
}

describe("LegalPage, drawing the owner's text (R55 · 220–224)", () => {
  it.each([
    ["privacy", "Privacy policy"],
    ["terms", "Terms of use"],
    ["copyright", "Copyright"],
  ] as const)("titles /%s with the boards' short name", async (slug, title) => {
    await renderDraft(slug);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      new RegExp(`^${title}$`, "u"),
    );
  });

  it("draws the draft banner as the notice block under the title", async () => {
    await renderDraft("privacy");
    const notice = firstRow().nextElementSibling;
    expect(notice).toHaveClass("bg-notice", "rounded-none", "inset-ring-1");
    // The title and the notice sit at the text's width; only a wide
    // table steps out (R55·220, R2-LEGAL-05).
    expect(notice?.parentElement?.tagName).toBe("HEADER");
    expect(notice?.parentElement).toHaveClass("max-w-column");
    if (!(notice instanceof HTMLElement)) throw new TypeError("no notice");
    const [tag, line, provenance] = [...notice.children];
    expect(tag).toHaveTextContent(/^Draft$/u);
    expect(tag).toHaveClass("text-mono-xs", "text-ink");
    expect(line).toHaveTextContent(/^Not reviewed by a lawyer yet\.$/u);
    expect(line).toHaveClass("text-body", "text-ink");
    // Exactly: the space after the bold lead is not drawn.
    expect(provenance?.textContent).toBe(
      "Written from the code on main, for the owner to edit.",
    );
    expect(provenance).toHaveClass("text-small", "text-quiet");
    // Inline code is MONO.md, and never breaks.
    const main = within(notice).getByText("main");
    expect(main).toHaveClass("text-mono-md");
    expect(main.closest("code")).toHaveClass(
      "inline-block",
      "max-w-full",
      "wrap-anywhere",
    );
    // Drawn once: not again as a quote in the text.
    expect(screen.queryByText(/DRAFT/u)).toBeNull();
    // Another quote stays a quote.
    expect(screen.getByText("A quote that is not the banner.").tagName).toBe(
      "BLOCKQUOTE",
    );
  });

  it("never parts a file name from what touches it: a bracket before, punctuation after (R2-LEGAL-04)", async () => {
    const text =
      "See the app (`src/a.ts`). And `b`/`c` here, then `d`, and `e`";
    await renderWithRouter(
      <LegalPage
        slug="privacy"
        doc={parseLegalDoc(
          ["# Privacy policy", "", "## Names", "", text, "", "`f` opens."].join(
            "\n",
          ),
        )}
        bellState={undefined}
        bell={bell}
      />,
    );
    const runOf = (name: string): Element | undefined =>
      screen.getByText(name).closest("code")?.parentElement ?? undefined;
    // One unbreakable run each, holding only what touches the name.
    expect(runOf("src/a.ts")).toHaveClass("whitespace-nowrap");
    expect(runOf("src/a.ts")?.textContent).toBe("(src/a.ts).");
    expect(runOf("b")?.textContent).toBe("b/");
    expect(runOf("c")?.textContent).toBe("c");
    expect(runOf("d")?.textContent).toBe("d,");
    expect(runOf("e")?.textContent).toBe("e");
    expect(runOf("f")?.textContent).toBe("f");
    // A name may still break inside when it is longer than the line.
    expect(screen.getByText("b").closest("code")).toHaveClass(
      "whitespace-normal",
    );
    // Nothing is drawn twice or dropped: the words read as written.
    expect(runOf("src/a.ts")?.parentElement?.textContent).toBe(
      text.replaceAll("`", ""),
    );
    expect(runOf("f")?.parentElement?.textContent).toBe("f opens.");
  });

  it("draws no notice for a text without the banner", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    expect(firstRow().nextElementSibling).toBeNull();
  });

  it("draws a banner with nothing after its bold lead as the two lines alone", async () => {
    await renderWithRouter(
      <LegalPage
        slug="privacy"
        doc={parseLegalDoc("> **DRAFT: not reviewed.**\n\n# T\n\nWords.")}
        bellState={undefined}
        bell={bell}
      />,
    );
    const notice = firstRow().nextElementSibling;
    expect(notice?.children).toHaveLength(2);
    expect(screen.getByText("Words.").tagName).toBe("P");
  });

  it("reads a quote that opens otherwise as a quote", async () => {
    await renderWithRouter(
      <LegalPage
        slug="privacy"
        doc={parseLegalDoc(
          "> **DRAFTSMAN** words.\n\n> **Not a DRAFT**\n\n> Note **DRAFT: x**\n\n**DRAFT** in a paragraph.\n\n# T\n\n> **Note:** DRAFT words.\n\n> DRAFT plain\n\n> `DRAFT` code",
        )}
        bellState={undefined}
        bell={bell}
      />,
    );
    expect(firstRow().nextElementSibling).toBeNull();
    expect(screen.getAllByRole("blockquote")).toHaveLength(6);
    const paragraphBold = screen.getByText("DRAFT", { selector: "strong" });
    expect(paragraphBold.closest("p")).not.toBeNull();
    // Bold that opens a paragraph is not a list item's lead-in.
    expect(paragraphBold).toHaveClass("font-semibold");
    expect(paragraphBold).not.toHaveClass("text-body");
  });

  it("writes the name plain, in prose, headings and the contents", async () => {
    await renderDraft("privacy");
    expect(screen.queryByText(/\[dialed\.run\]/u)).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "Who can use dialed.run" }),
    ).toHaveAttribute("id", "who-can-use-dialedrun");
    const link = within(
      screen.getByRole("navigation", { name: "Contents" }),
    ).getByRole("link");
    expect(link).toHaveTextContent(/^Who can use dialed\.run$/u);
    expect(link).toHaveClass("target-line", "underline");
    expect(screen.getByText(/^dialed\.run is run by us\./u).tagName).toBe("P");
  });

  it("draws an owner's note on hi-viz, led by its tag, without brackets", async () => {
    await renderDraft("privacy");
    const tag = screen.getByText("Owner");
    expect(tag).toHaveClass("text-mono-xs");
    const note = tag.parentElement;
    expect(note?.tagName).toBe("MARK");
    expect(note).toHaveClass("bg-hi-viz", "text-accent-ink");
    expect(note?.textContent).toBe("Owner the day the first invite is sent");
    expect(note?.parentElement?.textContent).toBe(
      "Effective: Owner the day the first invite is sent",
    );
  });

  it("links every address, drawn as the text's own links are", async () => {
    await renderDraft("privacy");
    const hello = screen.getByRole("link", { name: "hello@dialed.run" });
    expect(hello).toHaveAttribute("href", "mailto:hello@dialed.run");
    expect(hello).toHaveAttribute("data-target", "inline");
    expect(hello).toHaveClass("text-ink", "underline");
    // The punctuation around it stays text.
    expect(hello.parentElement?.textContent).toBe(
      "dialed.run is run by us. Write to hello@dialed.run, or (desk@dialed.run). Also a@x.run; b@x.run: c@x.run. Not @x.run, d@.run or e@run. Plain bold in a paragraph.",
    );
    expect(
      within(hello.parentElement ?? document.body)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["hello@dialed.run", "mailto:hello@dialed.run"],
      ["desk@dialed.run", "mailto:desk@dialed.run"],
      ["a@x.run", "mailto:a@x.run"],
      ["b@x.run", "mailto:b@x.run"],
      ["c@x.run", "mailto:c@x.run"],
    ]);
    expect(
      screen.getByRole("link", { name: "desk@dialed.run" }),
    ).toHaveAttribute("href", "mailto:desk@dialed.run");
    // A link's own words are not linked again; a word with no dot after
    // its @ is not an address.
    expect(
      screen.getByRole("link", { name: "us" }).querySelector("a"),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "a@b" })).toBeNull();
  });

  it("sets a list's bold lead-in at its sentence's size, 600 (R58·291)", async () => {
    await renderDraft("privacy");
    const lead = screen.getByText("Account email.");
    expect(lead.tagName).toBe("STRONG");
    expect(lead).toHaveClass("font-semibold");
    // No step of its own: it takes its sentence's, the article's TYPE.lead.
    expect(lead).not.toHaveClass("text-body");
    expect(lead.parentElement?.textContent).toBe(
      "Account email. Sent from us, not a@b.",
    );
    expect(screen.getByText("Plain item.").tagName).toBe("LI");
    // Bold later in an item, or in a paragraph, is drawn the same.
    for (const name of ["bold"]) {
      for (const strong of screen.getAllByText(name)) {
        expect(strong.tagName).toBe("STRONG");
        expect(strong).toHaveClass("font-semibold");
        expect(strong).not.toHaveClass("text-body");
      }
    }
    expect(screen.getAllByText("bold")).toHaveLength(2);
  });

  it("heads sections in the display face on a hairline, and sub-sections a step down", async () => {
    await renderDraft("privacy");
    const heading = screen.getByRole("heading", {
      level: 2,
      name: /^Who can/u,
    });
    expect(heading).toHaveClass("font-display", "text-title");
    expect(heading.closest("section")).toHaveClass(
      "mt-8",
      "border-t",
      "border-hairline",
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Processors" }),
    ).toHaveClass("font-display", "text-heading");
  });

  it("draws a table of more than two columns as cards at every width (R57·265, as built)", async () => {
    await renderDraft("privacy");
    // GUESS (R57·265, Design 315 #761): no 1440 step, so the cards at
    // every width and no seven-column breakout.
    expect(screen.queryByRole("table")).toBeNull();
    const cards = screen.getByText("Sentry", { selector: "p" }).closest("ul");
    if (cards === null) throw new Error("no cards");
    expect(cards).toHaveClass("flex", "flex-col", "gap-3", "list-none");
    expect(cards).not.toHaveClass("desk:hidden");
    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const [sentry, , short] = items;
    if (sentry === undefined || short === undefined) {
      throw new Error("no card");
    }
    // One heading, and a row shorter than the head labels what it has.
    expect(sentry.querySelectorAll(":scope > p")).toHaveLength(1);
    expect(
      [...short.querySelectorAll("dt")].map((term) => term.textContent),
    ).toEqual(["Company"]);
    // A flex box, so a wrapped label sets at MONO.xs's leading (R2-LEGAL-09).
    expect(short.querySelector("dt")).toHaveClass("flex");
    expect(
      [...short.querySelectorAll("dd")].map((value) => value.textContent),
    ).toEqual(["Only"]);
    expect(sentry).toHaveClass("bg-panel", "rounded-card", "border-hairline");
    expect(sentry.firstElementChild).toHaveTextContent(/^Sentry$/u);
    expect(sentry.firstElementChild).toHaveClass("font-semibold");
    // GUESS (R55·220): each value's label is its column's header.
    expect(
      [...sentry.querySelectorAll("dt")].map((term) => term.textContent),
    ).toEqual(["Company", "Role"]);
    expect(
      [...sentry.querySelectorAll("dd")].map((value) => value.textContent),
    ).toEqual(["Functional Software", "Processor"]);
    expect(sentry.querySelector(":scope dt span")).toHaveClass("text-mono-xs");
  });

  it("keeps a two-column table a table at every width", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    const table = screen.getByRole("table");
    const wrapper = table.parentElement;
    expect(wrapper).toHaveClass("overflow-x-auto");
    expect(wrapper).not.toHaveClass("hidden");
    // R58·289: one table language, the wide table's panel, mono headers
    // and TYPE.body.
    expect(wrapper).toHaveClass(
      "rounded-card",
      "border",
      "border-hairline",
      "bg-panel",
    );
    expect(table).toHaveClass("text-body");
    expect(table).not.toHaveClass("text-small");
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).toHaveClass("border-b", "border-hairline", "font-normal");
      expect(header).not.toHaveClass("border-ink");
      expect(header.firstElementChild).toHaveClass(
        "text-mono-xs",
        "text-muted",
      );
    }
    const rows = within(table).getAllByRole("row").slice(1);
    for (const row of rows) {
      expect(row).toHaveClass("border-b", "border-hairline", "last:border-b-0");
    }
    expect(within(table).getAllByRole("cell")[0]).toHaveClass("align-top");
  });

  it("holds the rail at 240 and lets the rail scroll", async () => {
    await renderDraft("privacy");
    expect(screen.getByRole("main").firstElementChild).toHaveClass(
      "desk:grid-cols-[240px_minmax(0,1fr)]",
      "desk:max-w-page",
    );
    expect(screen.getByRole("navigation", { name: "Contents" })).toHaveClass(
      "desk:overflow-y-auto",
    );
  });
});
