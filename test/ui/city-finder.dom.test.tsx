import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CityLookup, ResolvedPlace } from "../../src/lib/contracts";
import { CITY_HINT, CityFinder } from "../../src/ui";
import type { FieldProps } from "../../src/ui";

/**
 * The typed city (round 26 #12): the field and Find beside it, the
 * provider's one answer as "Weather for {resolved}" with Use this, and
 * nothing used until Use this. The same field on O1 and Your conditions.
 */

const PORTLAND: ResolvedPlace = {
  address: "Portland, OR, United States",
  lat: 45.52,
  lng: -122.68,
};
const FOUND: CityLookup = { kind: "found", ...PORTLAND };

type LookUp = (input: { data: { label: string } }) => Promise<CityLookup>;

function Harness({
  lookUp,
  onUse,
  announce,
  field,
  error,
  using,
  onSubmit,
}: Readonly<{
  lookUp: LookUp;
  onUse: (place: ResolvedPlace) => void;
  announce: (status: string) => void;
  field?: (name: string) => FieldProps;
  error?: string;
  using?: boolean;
  onSubmit: () => void;
}>) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <CityFinder
        name="cityLabel"
        label="Your city"
        value={value}
        onChange={setValue}
        field={field}
        error={error}
        lookUp={lookUp}
        onUse={onUse}
        using={using}
        announce={announce}
      />
    </form>
  );
}

function setup(props: Partial<Parameters<typeof Harness>[0]> = {}) {
  const lookUp = vi.fn<LookUp>(props.lookUp ?? (() => Promise.resolve(FOUND)));
  const onUse = vi.fn<(place: ResolvedPlace) => void>();
  const announce = vi.fn<(status: string) => void>();
  const onSubmit = vi.fn<() => void>();
  render(
    <Harness
      onUse={onUse}
      announce={announce}
      onSubmit={onSubmit}
      {...props}
      lookUp={lookUp}
    />,
  );
  return { lookUp, onUse, announce, onSubmit, user: userEvent.setup() };
}

const field = () => screen.getByLabelText("Your city");
const findButton = () => screen.getByRole("button", { name: "Find" });
const findPart = () => part("find");

function part(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-part="${CSS.escape(name)}"]`,
  );
  if (element === null) throw new Error(`no ${name}`);
  return element;
}

describe("CityFinder", () => {
  it("draws the field with round 26's hint and Find beside it", () => {
    setup();
    expect(field()).toHaveAttribute("name", "cityLabel");
    expect(field()).toHaveAttribute("autocomplete", "address-level2");
    expect(screen.getByText(CITY_HINT)).toBeVisible();
    expect(CITY_HINT).toBe(
      "Add the state or country. We'll show you the place we found before we use it.",
    );
    expect(findButton()).toHaveAttribute("type", "button");
    expect(document.querySelector('[data-part="resolved"]')).toBeNull();
    // Nothing is wrong yet, so the field points at no message.
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(field()).not.toHaveAttribute("aria-describedby");
  });

  it("finds once, shows the provider's place, and uses nothing until Use this", async () => {
    const { lookUp, onUse, announce, user } = setup();

    await user.type(field(), "  Portland  ");
    await user.click(findButton());

    expect(lookUp).toHaveBeenCalledTimes(1);
    expect(lookUp).toHaveBeenCalledWith({ data: { label: "Portland" } });
    const resolved = await screen.findByText("Portland, OR, United States");
    expect(resolved.closest("p")).toHaveTextContent(
      "Weather for Portland, OR, United States",
    );
    expect(screen.getByText("Not it? Add more to the name.")).toBeVisible();
    expect(announce).toHaveBeenCalledWith(
      "Weather for Portland, OR, United States.",
    );
    expect(onUse).not.toHaveBeenCalled();

    const useThis = screen.getByRole("button", { name: "Use this" });
    expect(useThis).toHaveAttribute("type", "button");
    await user.click(useThis);
    expect(onUse).toHaveBeenCalledWith(PORTLAND);
  });

  it("finds on Enter, and Enter never submits the form around it", async () => {
    const { lookUp, onSubmit, user } = setup();

    await user.type(field(), "Portland{Enter}");

    await screen.findByText("Portland, OR, United States");
    expect(lookUp).toHaveBeenCalledWith({ data: { label: "Portland" } });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("lets other keys through to the field", async () => {
    const { lookUp, user } = setup();
    await user.type(field(), "Bend");
    expect(field()).toHaveValue("Bend");
    expect(lookUp).not.toHaveBeenCalled();
  });

  it("says in the field when nothing was typed, and asks nobody", async () => {
    const { lookUp, announce, user } = setup();

    await user.click(findButton());

    expect(screen.getByText("Type the city you run in.")).toBeVisible();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAttribute("aria-describedby", "cityLabel-message");
    expect(announce).toHaveBeenCalledWith("Type the city you run in.");
    expect(lookUp).not.toHaveBeenCalled();
  });

  it("puts a place nobody can find on the field, quoting what was typed", async () => {
    const { announce, user } = setup({
      lookUp: () => Promise.resolve({ kind: "not-found" }),
    });

    await user.type(field(), "Portlnd, OR");
    await user.click(findButton());

    const message = `We couldn't find "Portlnd, OR". Check the spelling, or try a nearby city.`;
    expect(await screen.findByText(message)).toBeVisible();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(announce).toHaveBeenCalledWith(message);
    // A field message, not the band: the fix is in the field.
    expect(document.querySelector('[data-part="failure-band"]')).toBeNull();
    // And the hint steps aside for it.
    expect(screen.queryByText(CITY_HINT)).toBeNull();
  });

  it("shows the NOT FOUND YET band when the lookup fails, and Try again asks again", async () => {
    const answers: CityLookup[] = [{ kind: "unavailable" }, FOUND];
    const { lookUp, announce, user } = setup({
      lookUp: () => Promise.resolve(answers.shift() ?? FOUND),
    });

    await user.type(field(), "Portland");
    await user.click(findButton());

    const band = await screen.findByText("Not found yet");
    expect(band.closest('[data-part="failure-band"]')).toHaveTextContent(
      "Couldn't look that up.",
    );
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(announce).toHaveBeenCalledWith(
      "Not found yet. Couldn't look that up.",
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Portland, OR, United States");
    expect(lookUp).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-part="failure-band"]')).toBeNull();
  });

  it("treats a request that never came back as a failed lookup", async () => {
    const { announce, user } = setup({
      lookUp: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    await user.type(field(), "Portland");
    await user.click(findButton());
    expect(await screen.findByText("Not found yet")).toBeVisible();
    expect(announce).toHaveBeenCalledWith(
      "Not found yet. Couldn't look that up.",
    );
    // And it stops looking: the field is the runner's again.
    expect(findPart()).not.toHaveAttribute("aria-busy");
    expect(field()).not.toHaveAttribute("readonly");
  });

  it("breathes while it looks, holds the field, and ignores a second press", async () => {
    const pending = Promise.withResolvers<CityLookup>();
    const { lookUp, user } = setup({ lookUp: () => pending.promise });

    await user.type(field(), "Portland");
    await user.click(findButton());

    expect(findPart()).toHaveAttribute("aria-busy", "true");
    expect(findPart()).toHaveAttribute("aria-disabled", "true");
    expect(findPart()).toHaveAccessibleName("Finding");
    expect(field()).toHaveAttribute("readonly");
    await user.click(findPart());
    expect(lookUp).toHaveBeenCalledTimes(1);

    pending.resolve(FOUND);
    await screen.findByText("Portland, OR, United States");
    expect(findPart()).not.toHaveAttribute("aria-busy");
    expect(field()).not.toHaveAttribute("readonly");
  });

  it("forgets what Find said once the name changes", async () => {
    const { user } = setup({
      lookUp: () => Promise.resolve({ kind: "not-found" }),
    });
    await user.type(field(), "Atlantis");
    await user.click(findButton());
    await screen.findByText(/We couldn't find "Atlantis"/u);

    await user.type(field(), "x");

    expect(screen.queryByText(/We couldn't find/u)).toBeNull();
    expect(field()).not.toHaveAttribute("aria-invalid");
  });

  it("drops a found place when the name changes, so Use this cannot use a stale one", async () => {
    const { user } = setup();
    await user.type(field(), "Portland");
    await user.click(findButton());
    await screen.findByText("Portland, OR, United States");

    await user.type(field(), ", ME");

    expect(document.querySelector('[data-part="resolved"]')).toBeNull();
  });

  it("clears an old field message before it asks again, typed or not", async () => {
    const answers: CityLookup[] = [{ kind: "not-found" }, FOUND];
    const { user } = setup({
      lookUp: () => Promise.resolve(answers.shift() ?? FOUND),
    });
    await user.type(field(), "Portland");
    await user.click(findButton());
    await screen.findByText(/We couldn't find "Portland"/u);

    await user.click(findButton());

    await screen.findByText("Portland, OR, United States");
    expect(screen.queryByText(/We couldn't find/u)).toBeNull();
    expect(field()).not.toHaveAttribute("aria-invalid");
  });

  it("clears an old answer before it asks again", async () => {
    const answers: CityLookup[] = [FOUND, { kind: "not-found" }];
    const { user } = setup({
      lookUp: () => Promise.resolve(answers.shift() ?? FOUND),
    });
    await user.type(field(), "Portland");
    await user.click(findButton());
    await screen.findByText("Portland, OR, United States");

    await user.click(findButton());

    await screen.findByText(/We couldn't find "Portland"/u);
    expect(document.querySelector('[data-part="resolved"]')).toBeNull();
  });

  it("shows the surrounding form's message when it has none of its own", async () => {
    const onInput = vi.fn<() => void>();
    const { user } = setup({
      error: "Press Find, or clear the field to skip.",
      field: (name) => ({
        name,
        readOnly: false,
        "aria-invalid": true,
        "aria-describedby": `${name}-message`,
        onInput,
      }),
    });

    expect(
      screen.getByText("Press Find, or clear the field to skip."),
    ).toBeVisible();
    expect(field()).toHaveAttribute("aria-invalid", "true");

    await user.type(field(), "P");
    expect(onInput).toHaveBeenCalled();
  });

  it("is read-only while the surrounding form is saving", () => {
    setup({
      field: (name) => ({
        name,
        readOnly: true,
        "aria-invalid": undefined,
        "aria-describedby": undefined,
        onInput: vi.fn<() => void>(),
      }),
    });
    expect(field()).toHaveAttribute("readonly");
  });

  it("says Use this is in flight while the caller saves", async () => {
    const { user } = setup({ using: true });
    await user.type(field(), "Portland");
    await user.click(findButton());
    await screen.findByText("Portland, OR, United States");

    expect(part("use-this")).toHaveAttribute("aria-busy", "true");
    expect(part("use-this")).toHaveAccessibleName("Saving");
  });
});
