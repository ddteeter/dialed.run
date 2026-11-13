import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { LegalPage } from "../../src/modules/account/components/LegalPage";
import { parseLegalDoc } from "../../src/modules/account/legal-markdown";

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
    "",
    "- **Account email.** Sent from [us](mailto:hello@dialed.run), not a@b.",
    "- Plain item.",
    "",
    "### Processors",
    "",
    "| Service | Company | Role |",
    "| ------- | ------- | ---- |",
    "| Sentry  | Functional Software | Processor |",
    "| OpenAI  | OpenAI OpCo | Processor |",
  ].join("\n"),
);

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
    const notice = screen.getByRole("heading", { level: 1 }).nextElementSibling;
    expect(notice).toHaveClass("bg-notice", "rounded-none", "inset-ring-1");
    if (!(notice instanceof HTMLElement)) throw new TypeError("no notice");
    const [tag, line, provenance] = [...notice.children];
    expect(tag).toHaveTextContent(/^Draft$/u);
    expect(tag).toHaveClass("text-mono-xs", "text-ink");
    expect(line).toHaveTextContent(/^Not reviewed by a lawyer yet\.$/u);
    expect(line).toHaveClass("text-body", "text-ink");
    expect(provenance).toHaveTextContent(
      /^Written from the code on main, for the owner to edit\.$/u,
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

  it("draws no notice for a text without the banner", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    expect(
      screen.getByRole("heading", { level: 1 }).nextElementSibling,
    ).toBeNull();
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
    const notice = screen.getByRole("heading", { level: 1 }).nextElementSibling;
    expect(notice?.children).toHaveLength(2);
    expect(screen.getByText("Words.").tagName).toBe("P");
  });

  it("reads a quote that opens otherwise as a quote", async () => {
    await renderWithRouter(
      <LegalPage
        slug="privacy"
        doc={parseLegalDoc(
          "# T\n\n> **Note:** DRAFT words.\n\n> DRAFT plain\n\n> `DRAFT` code",
        )}
        bellState={undefined}
        bell={bell}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1 }).nextElementSibling,
    ).toBeNull();
    expect(screen.getAllByRole("blockquote")).toHaveLength(3);
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
    expect(note).toHaveTextContent(/^Owner the day the first invite is sent$/u);
    expect(note?.parentElement).toHaveTextContent(
      /^Effective: Owner the day the first invite is sent$/u,
    );
  });

  it("links every address, drawn as the text's own links are", async () => {
    await renderDraft("privacy");
    const hello = screen.getByRole("link", { name: "hello@dialed.run" });
    expect(hello).toHaveAttribute("href", "mailto:hello@dialed.run");
    expect(hello).toHaveAttribute("data-target", "inline");
    expect(hello).toHaveClass("text-ink", "underline");
    // The punctuation around it stays text.
    expect(hello.parentElement).toHaveTextContent(
      /^dialed\.run is run by us\. Write to hello@dialed\.run, or \(desk@dialed\.run\)\.$/u,
    );
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

  it("sets a list's bold lead-in at TYPE.body 600, and only the lead-in", async () => {
    await renderDraft("privacy");
    const lead = screen.getByText("Account email.");
    expect(lead.tagName).toBe("STRONG");
    expect(lead).toHaveClass("text-body", "font-semibold");
    expect(lead.parentElement).toHaveTextContent(
      /^Account email\. Sent from us, not a@b\.$/u,
    );
    expect(screen.getByText("Plain item.").tagName).toBe("LI");
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

  it("draws a table of more than two columns as cards below the desk and a broken-out table at it", async () => {
    await renderDraft("privacy");
    const cards = screen
      .getAllByRole("list")
      .find((list) => list.classList.contains("desk:hidden"));
    if (cards === undefined) throw new Error("no cards");
    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const [sentry] = items;
    if (sentry === undefined) throw new Error("no card");
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
    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass(
      "hidden",
      "desk:block",
      "desk:w-[calc(100cqw-var(--spacing)*72)]",
      "bg-panel",
    );
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Service", "Company", "Role"]);
    const cells = within(table).getAllByRole("cell");
    expect(cells[0]).toHaveClass("font-semibold");
    expect(cells[1]).not.toHaveClass("font-semibold");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Sentry",
      "Functional Software",
      "Processor",
      "OpenAI",
      "OpenAI OpCo",
      "Processor",
    ]);
  });

  it("keeps a two-column table a table at every width", async () => {
    await renderWithRouter(
      <LegalPage slug="privacy" doc={DOC} bellState={undefined} bell={bell} />,
    );
    const wrapper = screen.getByRole("table").parentElement;
    expect(wrapper).toHaveClass("overflow-x-auto");
    expect(wrapper).not.toHaveClass("hidden");
  });

  it("holds the rail at 240, the page in a container, and lets the rail scroll", async () => {
    await renderDraft("privacy");
    expect(screen.getByRole("main")).toHaveClass(
      "@container",
      "desk:grid-cols-[240px_minmax(0,1fr)]",
      "desk:max-w-page",
    );
    expect(screen.getByRole("navigation", { name: "Contents" })).toHaveClass(
      "desk:overflow-y-auto",
    );
  });
});
