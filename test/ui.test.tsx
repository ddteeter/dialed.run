import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  Bracketed,
  Layout,
  Mono,
  Sheet,
  Skeleton,
  TabBar,
  Wordmark,
} from "../src/ui";

/**
 * TabBar (and therefore Layout) renders typed <Link> elements, which need
 * router context; a minimal memory router provides it.
 */
async function renderWithRouter(element: ReactElement): Promise<string> {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

/**
Strips tags and comments without a backtracking-prone regex.
*/
function textOf(html: string): string {
  return html
    .split("<")
    .map((chunk) => {
      const end = chunk.indexOf(">");
      return end === -1 ? chunk : chunk.slice(end + 1);
    })
    .join("");
}

describe("Mono", () => {
  it("renders its value in an uppercase tracked mono span", () => {
    const html = renderToString(<Mono>7:42 /mi</Mono>);
    expect(html).toContain("font-mono");
    expect(html).toContain("uppercase");
    expect(html).toContain("7:42 /mi");
  });
});

describe("Bracketed", () => {
  it("wraps the value in square brackets", () => {
    const html = renderToString(<Bracketed>untested</Bracketed>);
    const text = textOf(html);
    expect(text.startsWith("[")).toBe(true);
    expect(text.endsWith("]")).toBe(true);
    expect(text).toContain("untested");
  });
});

describe("Wordmark", () => {
  it('renders "dialed" and ".run"', () => {
    const html = renderToString(<Wordmark />);
    expect(html).toContain("dialed");
    expect(html).toContain(".run");
  });
});

describe("Skeleton", () => {
  it("renders a block at the caller-specified dimensions", () => {
    const html = renderToString(<Skeleton className="h-4 w-24" />);
    expect(html).toContain("h-4 w-24");
    expect(html).toContain("animate-pulse");
  });
});

describe("Sheet", () => {
  it("renders a dialog with its content and label", () => {
    const html = renderToString(
      <Sheet open={false} onClose={vi.fn()} label="Pick a category">
        sheet content
      </Sheet>,
    );
    expect(html).toContain("<dialog");
    expect(html).toContain("Pick a category");
    expect(html).toContain("sheet content");
  });
});

describe("TabBar", () => {
  it("renders the five tab labels", async () => {
    const html = await renderWithRouter(<TabBar />);
    for (const label of ["Feed", "Closet", "+ Add", "Call", "You"]) {
      expect(html).toContain(label);
    }
  });
});

describe("Layout", () => {
  it("renders its children inside the shell with the tab bar", async () => {
    const html = await renderWithRouter(
      <Layout>
        <p>hero copy goes here</p>
      </Layout>,
    );
    expect(html).toContain("hero copy goes here");
    expect(html).toContain("Closet");
  });
});
