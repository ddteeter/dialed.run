import { readFileSync } from "node:fs";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  DESK_MEDIA_QUERY,
  DeskDetail,
  DeskPaneName,
} from "../../src/ui/DeskDetail";
import { atWidth } from "./desk-width";

/**
 * Read off disk, through a path in a variable: Vite rewrites a literal
 * `new URL("…", import.meta.url)` into a served asset URL, which
 * `readFileSync` refuses.
 */
const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const styles = read("../../src/styles.css");

const PICKED = {
  name: "@ada",
  detail: (
    <>
      <DeskPaneName>
        <p>the name line</p>
      </DeskPaneName>
      <p>the detail</p>
    </>
  ),
};

function table(
  picked: (typeof PICKED & { isCode?: boolean }) | undefined,
  onUnpick: () => void = vi.fn<() => void>(),
) {
  return (
    <DeskDetail picked={picked} idle={<p>Pick one.</p>} onUnpick={onUnpick}>
      <p>the table</p>
    </DeskDetail>
  );
}

/**
 * A Desk table and its detail pane (168.3, R55·203): the frame Runners
 * and Codes share. From desk the pane sits beside the table; below it,
 * the picked thing opens as the desk drawer over it (R55·202).
 */
describe("DeskDetail at desk", () => {
  it("puts the table beside the pane on a 2fr/1fr track from desk, top-aligned", () => {
    atWidth(true);
    const { container } = render(table(undefined));
    expect(container.firstElementChild).toHaveClass(
      "grid",
      "grid-cols-[minmax(0,1fr)]",
      "items-start",
      "gap-6",
      "desk:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
    );
  });

  it("gives the table the whole width while there is no pane to hold (R2-DESK-03)", () => {
    atWidth(true);
    const { container } = render(
      <DeskDetail picked={undefined} onUnpick={vi.fn<() => void>()}>
        <p>the table</p>
      </DeskDetail>,
    );
    // One track only: no idle line and nothing picked, so no 1fr reserved.
    expect(container.firstElementChild?.className).toBe(
      "grid grid-cols-[minmax(0,1fr)] items-start gap-6",
    );
  });

  it("splits the width once something is picked, with no idle line", () => {
    atWidth(true);
    const { container } = render(
      <DeskDetail picked={PICKED} onUnpick={vi.fn<() => void>()}>
        <p>the table</p>
      </DeskDetail>,
    );
    expect(container.firstElementChild).toHaveClass(
      "desk:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
    );
  });

  it("holds the idle line while nothing is picked, and no pane", () => {
    atWidth(true);
    render(table(undefined));
    expect(screen.getByText("Pick one.").parentElement).toHaveClass(
      "hidden",
      "desk:block",
    );
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("draws the picked thing in a named, sticky --panel pane instead", () => {
    atWidth(true);
    render(table(PICKED));
    const pane = screen.getByRole("complementary", { name: "@ada" });
    expect(pane).toHaveTextContent("the detail");
    expect(pane).toHaveClass(
      "flex",
      "flex-col",
      "gap-4",
      "rounded-card",
      "bg-panel",
      "desk:sticky",
      "desk:top-6",
    );
    expect(screen.queryByText("Pick one.")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the detail's own name line in the pane, its only name on screen (#663)", () => {
    atWidth(true);
    render(table(PICKED));
    const pane = screen.getByRole("complementary", { name: "@ada" });
    expect(within(pane).getByText("the name line")).toBeVisible();
  });
});

describe("DeskDetail below desk (R55·202)", () => {
  it("opens the picked thing as a non-modal drawer named for it, the table still there", () => {
    atWidth(false);
    const show = vi.spyOn(HTMLDialogElement.prototype, "show");
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    onTestFinished(() => {
      show.mockRestore();
      showModal.mockRestore();
    });
    render(table(PICKED));
    const drawer = screen.getByRole("dialog", { name: "@ada" });
    expect(drawer).toHaveAttribute("open");
    expect(drawer).toHaveTextContent("the detail");
    // `show()`, not `showModal()`: the table beside it stays live.
    expect(show).toHaveBeenCalledOnce();
    expect(showModal).not.toHaveBeenCalled();
    expect(screen.getByText("the table")).toBeVisible();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("drops the detail's own name line, since the drawer's title says it (#663)", () => {
    atWidth(false);
    render(table(PICKED));
    const drawer = screen.getByRole("dialog", { name: "@ada" });
    expect(within(drawer).getByRole("heading", { name: "@ada" })).toBeVisible();
    expect(within(drawer).queryByText("the name line")).toBeNull();
    expect(within(drawer).getByText("the detail")).toBeVisible();
  });

  it("titles the drawer in words for a runner, in mono for a code (R57·251)", () => {
    atWidth(false);
    const { rerender } = render(table(PICKED));
    expect(screen.getByRole("heading", { level: 2, name: "@ada" })).toHaveClass(
      "font-display",
    );
    rerender(table({ ...PICKED, name: "DIAL-TEST", isCode: true }));
    expect(
      screen.getByRole("heading", { level: 2, name: "DIAL-TEST" }),
    ).toHaveClass("font-mono", "text-mono-lg");
    rerender(table({ ...PICKED, name: "DIAL-TEST", isCode: false }));
    expect(
      screen.getByRole("heading", { level: 2, name: "DIAL-TEST" }),
    ).toHaveClass("font-display");
  });

  it("spaces the drawer's blocks 16 apart, as the pane does (R2-DESK-04)", () => {
    atWidth(false);
    render(table(PICKED));
    const drawer = screen.getByRole("dialog", { name: "@ada" });
    expect(within(drawer).getByText("the detail").parentElement).toHaveClass(
      "flex",
      "flex-col",
      "gap-4",
    );
  });

  it("keeps the table to the screen's width below desk (R2-DESK-01)", () => {
    atWidth(false);
    const { container } = render(table(undefined));
    // An explicit track, never an implicit `auto` one a long line widens.
    expect(container.firstElementChild).toHaveClass(
      "grid-cols-[minmax(0,1fr)]",
    );
  });

  it("unpicks when the drawer's ✕ closes it", async () => {
    atWidth(false);
    const onUnpick = vi.fn<() => void>();
    render(table(PICKED, onUnpick));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onUnpick).toHaveBeenCalledOnce();
  });

  it("hides the idle line below desk, where nothing opens beside the table (R58·276)", () => {
    atWidth(false);
    render(table(undefined));
    const idle = document.querySelector("[data-part='desk-idle']");
    expect(idle).toHaveTextContent("Pick one.");
    expect(idle).toHaveClass("hidden", "desk:block");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("adds no idle wrapper when there is no idle line", () => {
    atWidth(true);
    render(
      <DeskDetail picked={undefined} onUnpick={vi.fn<() => void>()}>
        <p>the table</p>
      </DeskDetail>,
    );
    expect(document.querySelector("[data-part='desk-idle']")).toBeNull();
  });

  it("moves the picked thing between drawer and pane as the window crosses desk", () => {
    const window = atWidth(false);
    const { unmount } = render(table(PICKED));
    expect(screen.getByRole("dialog", { name: "@ada" })).toBeInTheDocument();
    act(() => {
      window.resize(true);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("complementary", { name: "@ada" })).toBeVisible();
    // And stops listening once it is gone.
    expect(window.listening()).toBe(1);
    unmount();
    expect(window.listening()).toBe(0);
  });
});

describe("DeskDetail with no window to ask", () => {
  it("is the pane, as the server sends it", () => {
    vi.stubGlobal("matchMedia", undefined);
    try {
      render(table(PICKED));
      expect(screen.getByRole("complementary", { name: "@ada" })).toBeVisible();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends the pane from the server whatever the window, so hydration agrees", () => {
    atWidth(false);
    const html = renderToString(table(PICKED));
    expect(html).toContain('data-part="desk-pane"');
    expect(html).not.toContain("<dialog");
  });
});

describe("what DeskDetail restates, pinned to its source", () => {
  it("the desk media query is the theme's desk breakpoint", () => {
    const width = /--breakpoint-desk:\s*(\d+px);/u.exec(styles)?.[1];
    expect(DESK_MEDIA_QUERY).toBe(`(min-width: ${String(width)})`);
  });
});
