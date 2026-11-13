import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { THEME_KEY } from "../../src/lib/browser/theme";
import type { ThemeChoice } from "../../src/lib/contracts";
import {
  THEME_LABELS,
  THEME_SAVE_KICKER,
  THEME_SAVE_MESSAGE,
  ThemeSwitch,
} from "../../src/ui/ThemeSwitch";

/**
 * U1 › Display › Theme (R48·133, design 185).
 */
const root = document.documentElement;

afterEach(() => {
  delete root.dataset.theme;
  localStorage.clear();
});

type Save = (input: { data: { theme: ThemeChoice } }) => Promise<unknown>;

function setUp(initial: ThemeChoice, save: Save) {
  render(<ThemeSwitch initial={initial} save={save} />);
  return {
    group: screen.getByRole("group", { name: "Theme" }),
    radio: (name: string) => screen.getByRole("radio", { name }),
  };
}

const band = () =>
  document.querySelector<HTMLElement>("[data-part='control-failure']");

describe("ThemeSwitch", () => {
  it("offers SYSTEM / LIGHT / DARK, in that order, with the account's choice checked", () => {
    const { group, radio } = setUp(
      "dark",
      vi.fn(() => Promise.resolve()),
    );

    expect(
      within(group)
        .getAllByRole("radio")
        .map((input) => input.getAttribute("value")),
    ).toEqual(["system", "light", "dark"]);
    expect(THEME_LABELS).toStrictEqual({
      system: "System",
      light: "Light",
      dark: "Dark",
    });
    expect(radio("Dark")).toBeChecked();
    expect(radio("System")).not.toBeChecked();
    // Nothing has failed yet, and the group is never read-only: a tap is
    // always taken, even while a save is in flight.
    expect(band()).toBeNull();
    for (const input of within(group).getAllByRole("radio")) {
      expect(input).not.toHaveAttribute("readonly");
    }
  });

  it("titles the row Theme in bold, heard once as the group's name (#630 F-05)", () => {
    const { group } = setUp(
      "system",
      vi.fn(() => Promise.resolve()),
    );
    const row = group.closest("[data-part='theme-row']");
    const title = row?.firstElementChild;
    expect(title).toHaveTextContent(/^Theme$/u);
    expect(title).toHaveClass("text-body", "font-semibold");
    expect(title).not.toHaveClass("font-mono");
    expect(title).toHaveAttribute("aria-hidden", "true");
    // The legend still names the group, for the ear only.
    expect(group.querySelector("legend")).toHaveClass("sr-only");
    expect(group.querySelector("legend")).toHaveTextContent(/^Theme$/u);
  });

  it("draws the words as MONO.xs capitals and speaks them in sentence case", () => {
    // R50·143.3: capitals like every other segmented label. Round 52's
    // Accessibility Contract: the names heard are "System", "Light",
    // "Dark", which is the string; the capitals are Mono's CSS.
    const { group } = setUp(
      "system",
      vi.fn(() => Promise.resolve()),
    );
    for (const name of ["System", "Light", "Dark"]) {
      expect(within(group).getByText(name)).toHaveClass(
        "font-mono",
        "text-mono-xs",
        "uppercase",
      );
    }
  });

  it("changes the page and saves at once, with no Save", async () => {
    const save = vi.fn<Save>(() => Promise.resolve());
    const { radio } = setUp("system", save);

    await userEvent.click(radio("Dark"));

    expect(root).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(radio("Dark")).toBeChecked();
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ data: { theme: "dark" } });
    });
    expect(screen.queryByRole("button", { name: /save/iu })).toBeNull();
    expect(band()).toBeNull();
  });

  it("moves with the arrow keys, as a radiogroup does", async () => {
    const save = vi.fn<Save>(() => Promise.resolve());
    const { radio } = setUp("system", save);

    radio("System").focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(radio("Light")).toBeChecked();
    expect(root).toHaveAttribute("data-theme", "light");
  });

  it("keeps the theme when the save fails, and says the device has it", async () => {
    const save = vi.fn<Save>(() => Promise.reject(new Error("down")));
    const { group, radio } = setUp("system", save);

    await userEvent.click(radio("Dark"));

    await waitFor(() => {
      expect(band()).not.toBeNull();
    });
    expect(band()).toHaveTextContent(THEME_SAVE_KICKER);
    expect(band()).toHaveTextContent(THEME_SAVE_MESSAGE);
    expect(THEME_SAVE_KICKER).toBe("Couldn't save.");
    expect(THEME_SAVE_MESSAGE).toBe("This device will keep it.");
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(radio("Dark")).toBeChecked();
    // The band is the group's description while it shows.
    const describedBy = within(group)
      .getAllByRole("radio")[0]
      ?.getAttribute("aria-describedby");
    expect(band()?.parentElement?.id).toBe(describedBy);
  });

  it("tries the same choice again, and clears the band when it lands", async () => {
    let isDown = true;
    const save = vi.fn<Save>(() =>
      isDown ? Promise.reject(new Error("down")) : Promise.resolve(),
    );
    const { radio } = setUp("system", save);
    await userEvent.click(radio("Light"));
    await waitFor(() => {
      expect(band()).not.toBeNull();
    });

    isDown = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(band()).toBeNull();
    });
    expect(save).toHaveBeenLastCalledWith({ data: { theme: "light" } });
    expect(
      within(screen.getByRole("group", { name: "Theme" })).getAllByRole(
        "radio",
      )[0],
    ).not.toHaveAttribute("aria-describedby");
  });

  it("saves one after another, so the last choice is the one stored", async () => {
    const order: ThemeChoice[] = [];
    let release: (() => void) | undefined;
    const save = vi.fn<Save>(
      ({ data }) =>
        new Promise<void>((resolve) => {
          order.push(data.theme);
          release = resolve;
        }),
    );
    const { radio } = setUp("system", save);

    await userEvent.click(radio("Dark"));
    await waitFor(() => {
      expect(order).toEqual(["dark"]);
    });
    await userEvent.click(radio("Light"));
    // The second waits for the first.
    expect(order).toEqual(["dark"]);

    release?.();
    await waitFor(() => {
      expect(order).toEqual(["dark", "light"]);
    });
  });

  it("says nothing about an older save that fails while a newer one is in flight", async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    const save = vi
      .fn<Save>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { radio } = setUp("system", save);

    await userEvent.click(radio("Dark"));
    await userEvent.click(radio("Light"));
    first.reject(new Error("down"));

    // The Light save has started, so the Dark failure has been handled.
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(band()).toBeNull();
    second.resolve(undefined);
  });

  it("tells saves apart, not themes: an old Dark failing is not a new Dark's", async () => {
    const first = Promise.withResolvers<unknown>();
    const later = Promise.withResolvers<unknown>();
    const save = vi
      .fn<Save>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(() => later.promise);
    const { radio } = setUp("system", save);

    await userEvent.click(radio("Dark"));
    await userEvent.click(radio("Light"));
    await userEvent.click(radio("Dark"));
    first.reject(new Error("down"));

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(band()).toBeNull();
    later.resolve(undefined);
  });

  it("clears the band at once when the runner picks again", async () => {
    const save = vi
      .fn<Save>()
      .mockImplementationOnce(() => Promise.reject(new Error("down")))
      .mockImplementation(() => Promise.withResolvers<unknown>().promise);
    const { radio } = setUp("system", save);
    await userEvent.click(radio("Dark"));
    await waitFor(() => {
      expect(band()).not.toBeNull();
    });

    await userEvent.click(radio("Light"));

    expect(band()).toBeNull();
  });

  it("says nothing about an older save that lands after a newer one failed", async () => {
    const first = Promise.withResolvers<unknown>();
    const save = vi
      .fn<Save>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(() => Promise.reject(new Error("down")));
    const { radio } = setUp("system", save);

    await userEvent.click(radio("Dark"));
    await userEvent.click(radio("Light"));
    first.resolve(undefined);

    await waitFor(() => {
      expect(band()).not.toBeNull();
    });
  });
});
