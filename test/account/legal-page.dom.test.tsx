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
 * contents that link every H2, "↑ Contents" closing each section, and the
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
    "| What | How long |",
    "| ---- | -------- |",
    "| Runs | Kept     |",
  ].join("\n"),
);

function bell(count: number) {
  return <span data-testid="bell">{count}</span>;
}

describe("LegalPage", () => {
  it("reads in the signed-out shell for a signed-out reader", async () => {
    await renderWithRouter(
      <LegalPage doc={DOC} unreadCount={undefined} bell={bell} />,
    );
    expect(document.querySelector("[data-slot='landing-bar']")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot='tab-bar']")).toBeNull();
    expect(screen.queryByTestId("bell")).toBeNull();
  });

  it("reads in the signed-in shell, with the bell's count, for a signed-in reader", async () => {
    await renderWithRouter(<LegalPage doc={DOC} unreadCount={3} bell={bell} />);
    expect(document.querySelector("[data-slot='tab-bar']")).not.toBeNull();
    expect(document.querySelector("[data-slot='landing-bar']")).toBeNull();
    expect(screen.getAllByTestId("bell")[0]).toHaveTextContent("3");
  });

  it("titles the page and lists every H2 in the contents, linked to its id", async () => {
    await renderWithRouter(
      <LegalPage doc={DOC} unreadCount={undefined} bell={bell} />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy policy" }),
    ).toHaveClass("font-display", "text-display", "uppercase");
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

  it("gives every H2 its id and closes its section with ↑ Contents", async () => {
    await renderWithRouter(
      <LegalPage doc={DOC} unreadCount={undefined} bell={bell} />,
    );
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Who we are",
    });
    expect(heading).toHaveAttribute("id", "who-we-are");
    const section = heading.closest("section");
    expect(section).toHaveAttribute("aria-labelledby", "who-we-are");
    const back = within(section ?? document.body).getAllByRole("link", {
      name: "↑ Contents",
    });
    expect(back).toHaveLength(1);
    expect(back[0]).toHaveAttribute("href", "#contents");
    // The last thing in the section.
    expect(section?.lastElementChild).toBe(back[0]);
    expect(screen.getAllByRole("link", { name: "↑ Contents" })).toHaveLength(2);
  });

  it("keeps what comes before the first H2 out of any section", async () => {
    await renderWithRouter(
      <LegalPage doc={DOC} unreadCount={undefined} bell={bell} />,
    );
    const before = screen.getByText("Before any section.");
    expect(before.tagName).toBe("P");
    expect(before.closest("section")).toBeNull();
    expect(before.closest("article")).toHaveClass("max-w-column", "text-lead");
  });

  it("puts each H2's blocks in its own section, and no other", async () => {
    await renderWithRouter(
      <LegalPage doc={DOC} unreadCount={undefined} bell={bell} />,
    );
    const sectionOf = (name: string) =>
      screen.getByRole("heading", { level: 2, name }).closest("section");
    const first = sectionOf("Who we are");
    const second = sectionOf("Your choices");
    expect(first).toContainElement(screen.getByText("dialed.run"));
    expect(first).toContainElement(screen.getByText("us"));
    expect(second).toContainElement(screen.getByText("A note."));
    expect(second).toContainElement(screen.getByRole("table"));
    expect(first).not.toContainElement(screen.getByText("A note."));
  });

  it("renders bold, code, links, the H3, lists, quotes and tables", async () => {
    await renderWithRouter(
      <LegalPage doc={DOC} unreadCount={undefined} bell={bell} />,
    );
    expect(screen.getByText("dialed.run").tagName).toBe("STRONG");
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
