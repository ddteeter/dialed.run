import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { entryTags, verdictScale } from "../../src/lib/contracts";
import { maxPhotosPerEntry } from "../../src/lib/photo-constraints";
import { VerdictForm } from "../../src/modules/feed/components/VerdictForm";
import type { entryDetailForViewer } from "../../src/modules/feed/entries";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

/**
 * The verdict (screen A3) — the one screen the whole product turns on.
 *
 * A verdict is per-run on a -2..+2 scale with 0 meaning dialed, and the
 * per-item signal is a flag rather than a second verdict. Both of those
 * facts are only visible in what this sends.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const entryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed/entry/$entryId",
    component: () => <p>The entry</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, entryRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "01JENTRY000000000000000000",
    userId: "01JSER00000000000000000000",
    authorDisplayName: undefined,
    runId: "01JRAN00000000000000000000",
    runTitle: "Evening run",
    distanceM: 8047,
    durationS: 1830,
    startedAt: 1_755_000_000,
    indoor: false,
    verdict: undefined,
    isPublic: true,
    caption: undefined,
    createdAt: 1_755_000_000,
    items: [],
    photoKeys: [],
    tags: [],
    usefulCount: 0,
    conditions: undefined,
    viewerHasReacted: false,
    ...overrides,
  };
}

const item = (itemId: string, name: string) => ({
  itemId,
  name,
  brand: undefined,
  category: "top",
  layer: undefined,
  flag: undefined,
  note: undefined,
});

/**
 * The per-item flag pickers, in document order. Queried by role rather
 * than by tag so the elements carry testing-library's own types.
 */
function flagSelects(): HTMLElement[] {
  return screen.getAllByRole("combobox");
}

/**
The nth flag picker, or a clear failure rather than an `undefined`.
*/
function flagSelect(index: number): HTMLElement {
  const select = flagSelects()[index];
  if (select === undefined) throw new Error(`no flag select at ${String(index)}`);
  return select;
}

const nothing = () => Promise.resolve();
const noStat = () => Promise.resolve({ worn: 1, total: 1 });
const noUpload = () => Promise.resolve({ key: "k" });

/**
 * Rejects with `reason` exactly as given, never wrapped in an Error.
 *
 * That is the point, not a detail. A rejection from a server function has
 * crossed a structured clone, so it reaches the browser as a plain object
 * with no prototype — `instanceof Error` is false for a real one, which is
 * why `useFormSubmit` *parses* what came back instead of casting it. An
 * `Object.assign(new Error(), { issues })` would test a shape production
 * never produces.
 *
 * `throw reason` rather than `Promise.reject(reason)`: `reason` stays typed
 * `unknown` at the throw site, which `only-throw-error` allows by default,
 * where `prefer-promise-reject-errors` extends no such allowance. Same
 * helper as `test/ui/form.dom.test.tsx`; the rule's fitness for these tests
 * is written up in docs/designs/042.
 */
function rejectWith(reason: unknown): never {
  throw reason;
}


function form(
  overrides: {
    entry?: Partial<Entry>;
    bandFloor?: number;
    submitVerdict?: (input: { data: Record<string, unknown> }) => Promise<unknown>;
    uploadPhoto?: (input: { data: FormData }) => Promise<{ key: string }>;
    itemBandWearStat?: (input: {
      data: { itemId: string; bandFloorC: number };
    }) => Promise<{ worn: number; total: number }>;
  } = {},
) {
  return (
    <VerdictForm
      entry={entry(overrides.entry)}
      entryId="01JENTRY000000000000000000"
      bandFloor={overrides.bandFloor}
      submitVerdict={overrides.submitVerdict ?? nothing}
      uploadPhoto={overrides.uploadPhoto ?? noUpload}
      itemBandWearStat={overrides.itemBandWearStat ?? noStat}
    />
  );
}

describe("VerdictForm: the scale", () => {
  it("offers every verdict the contract defines, in order", async () => {
    // Read from `verdictScale`, not restated — the labels here and the
    // ones the feed renders are the same list.
    await renderWithRouter(form());

    const labels = verdictScale.map((choice) => choice.label);
    for (const label of labels) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
  });

  it("names each field the server rejects, in the words a person reads", async () => {
    // The client pre-check can only ever fail on `verdict` — every other
    // value comes from a controlled input and is well-formed by
    // construction — so one error, and one error renders no summary. The
    // *server* validates the same schema and can reject several at once,
    // which is the only path that reaches the summary and the labels.
    //
    // Without this the label map is four strings nothing reads, and a
    // mutant emptying any of them leaves a summary row with no name.
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        submitVerdict: () =>
          rejectWith({
            issues: [
              { path: ["verdict"], message: "Out of range." },
              { path: ["tags"], message: "That tag is retired." },
              { path: ["itemFlags"], message: "That piece is not on this run." },
              { path: ["isPublic"], message: "Not allowed for this account." },
            ],
          }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    expect(
      await screen.findByRole("button", { name: /How it felt/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Tags/ })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Per-item notes/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Sharing/ })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing saved. 4 fields need a fix.",
    );
  });

  it("refuses to save without one, and says why", async () => {
    // This used to be `disabled` on the submit button, which §5 bans: a
    // disabled button drops focus, stops announcing, and tells a user
    // nothing about why their tap did nothing. The schema refuses the
    // submission instead, and the sentence lives in `verdictSchema` where
    // every renderer of it can find it.
    const user = userEvent.setup();
    const submitVerdict = vi.fn(() => Promise.resolve(undefined));
    await renderWithRouter(form({ submitVerdict }));

    const save = screen.getByRole("button", { name: "Save verdict" });
    expect(save).toBeEnabled();

    await user.click(save);

    expect(await screen.findByText("Say how the kit felt.")).toBeVisible();
    expect(submitVerdict).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing saved. One field needs a fix.",
    );
  });

  it("marks the chosen one, and only that one", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("button", { name: "Dialed" }));

    expect(screen.getByRole("button", { name: "Dialed" })).toHaveClass("bg-night");
    expect(screen.getByRole("button", { name: "Way cold" })).not.toHaveClass(
      "bg-night",
    );
    expect(screen.getByRole("button", { name: "Save verdict" })).toBeEnabled();
  });

  it("leaves the unchosen ones outlined", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("button", { name: "Dialed" }));

    const other = screen.getByRole("button", { name: "Way cold" });
    expect(other).toHaveClass("border");
    expect(other).not.toHaveClass("bg-night");
  });

  it("starts from the verdict the entry already has", async () => {
    // Including 0: dialed is a verdict, and an editor that forgot it would
    // show the form as unanswered.
    await renderWithRouter(form({ entry: { verdict: 0 } }));

    expect(screen.getByRole("button", { name: "Dialed" })).toHaveClass("bg-night");
    expect(screen.getByRole("button", { name: "Save verdict" })).toBeEnabled();
  });

  it("sends the number, not the label", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));

    await user.click(screen.getByRole("button", { name: "Way warm" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      entryId: "01JENTRY000000000000000000",
      verdict: 2,
    });
  });
});

describe("VerdictForm: per-item flags", () => {
  it("offers a flag per item, defaulting to none", async () => {
    await renderWithRouter(
      form({ entry: { items: [item("01JTEMA0000000000000000000", "Houdini"), item("01JTEMB0000000000000000000", "Tights")] } }),
    );

    expect(screen.getByRole("heading", { name: "Per-item notes" })).toBeVisible();
    expect(screen.getByText("Houdini")).toBeVisible();
    const selects = flagSelects();
    expect(selects).toHaveLength(2);
    expect(
      within(flagSelect(0))
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toStrictEqual(["", "too_much", "not_enough"]);
  });

  it("shows an unset flag as No flag", async () => {
    // `?? ""` — a select with a value matching no option shows its first
    // one anyway, so the fallback is what keeps the control honest.
    await renderWithRouter(
      form({ entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] } }),
    );
    // The *selected option*, not the value: a select whose value matches
    // no option shows its first one regardless, so `toHaveValue("")` would
    // pass for a fallback of any nonsense at all.
    expect(
      within(flagSelect(0)).getByRole("option", { selected: true }),
    ).toHaveTextContent("No flag");
  });

  it("starts from the flag the item already carries", async () => {
    // Re-opening a verdict used to show every piece as unflagged, so
    // saving again cleared a flag the runner had set.
    await renderWithRouter(
      form({
        entry: {
          items: [
            { ...item("01JTEMA0000000000000000000", "Houdini"), flag: "not_enough" as const },
            item("01JTEMB0000000000000000000", "Tights"),
          ],
        },
      }),
    );

    expect(
      within(flagSelect(0)).getByRole("option", { selected: true }),
    ).toHaveTextContent("Not enough");
    expect(
      within(flagSelect(1)).getByRole("option", { selected: true }),
    ).toHaveTextContent("No flag");
  });

  it("sends a flag it was seeded with, unchanged", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(
      form({
        entry: {
          items: [{ ...item("01JTEMA0000000000000000000", "Houdini"), flag: "not_enough" as const }],
        },
        submitVerdict,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data.itemFlags).toStrictEqual([
      { itemId: "01JTEMA0000000000000000000", flag: "not_enough" },
    ]);
  });

  it("keeps each item's flag to itself", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({ entry: { items: [item("01JTEMA0000000000000000000", "Houdini"), item("01JTEMB0000000000000000000", "Tights")] } }),
    );

    await user.selectOptions(flagSelect(0), "too_much");

    expect(flagSelect(0)).toHaveValue("too_much");
    expect(flagSelect(1)).toHaveValue("");
  });

  it("says nothing about items when the entry has none", async () => {
    await renderWithRouter(form());
    expect(screen.queryByRole("heading", { name: "Per-item notes" })).toBeNull();
  });

  it("sends a flag for the item it was set on, and undefined for the rest", async () => {
    // There is no per-item verdict — the flag is the per-item signal, and
    // "no flag" has to travel as absent rather than as an empty string.
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini"), item("01JTEMB0000000000000000000", "Tights")] },
        submitVerdict,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.selectOptions(flagSelect(0), "too_much");
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data.itemFlags).toStrictEqual([
      { itemId: "01JTEMA0000000000000000000", flag: "too_much" },
      { itemId: "01JTEMB0000000000000000000", flag: undefined },
    ]);
  });

  it("sends an unset flag as absent, not as an empty string", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(
      form({ entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] }, submitVerdict }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    const select = flagSelect(0);
    await user.selectOptions(select, "too_much");
    await user.selectOptions(select, "");
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data.itemFlags).toStrictEqual([
      { itemId: "01JTEMA0000000000000000000", flag: undefined },
    ]);
  });
});

describe("VerdictForm: tags and sharing", () => {
  it("offers every tag the contract defines, in words", async () => {
    await renderWithRouter(form());
    for (const tag of entryTags) {
      expect(
        screen.getByRole("button", { name: tag.replaceAll("_", " ") }),
      ).toBeVisible();
    }
  });

  it("leaves unchosen tags outlined", async () => {
    await renderWithRouter(form());
    const chafed = screen.getByRole("button", { name: "chafed" });
    expect(chafed).toHaveClass("border");
    expect(chafed).not.toHaveClass("bg-night");
  });

  it("toggles a tag on and back off", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));
    const chafed = screen.getByRole("button", { name: "chafed" });

    await user.click(chafed);
    expect(screen.getByRole("button", { name: "chafed" })).toHaveClass("bg-night");

    await user.click(screen.getByRole("button", { name: "chafed" }));
    expect(screen.getByRole("button", { name: "chafed" })).not.toHaveClass(
      "bg-night",
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({ tags: [] });
  });

  it("starts from the tags the entry already has, and sends them", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(
      form({ entry: { tags: ["chafed"] }, submitVerdict }),
    );

    expect(screen.getByRole("button", { name: "chafed" })).toHaveClass("bg-night");

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      tags: ["chafed"],
    });
  });

  it("is shared by default, and can be made private", async () => {
    // Entries are public by default with a per-entry toggle.
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));
    const share = screen.getByLabelText(/Share this/);
    expect(share).toBeChecked();

    await user.click(share);
    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      isPublic: false,
    });
  });

  it("starts private when the entry already is", async () => {
    await renderWithRouter(form({ entry: { isPublic: false } }));
    expect(screen.getByLabelText(/Share this/)).not.toBeChecked();
  });
});

function fileInput(): HTMLInputElement {
  const input = document.querySelector("input[type='file']");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  return input;
}

function jpeg(name = "a.jpg"): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

describe("VerdictForm: photos", () => {


  it("shows the photos the entry already has", async () => {
    const { container } = await renderWithRouter(
      form({ entry: { photoKeys: ["entries/01USER/01ENTRY/a"] } }),
    );
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "/feed/photo/entries/01USER/01ENTRY/a");
  });

  it("shows no grid at all when there are none", async () => {
    // Not an empty grid: a four-column grid with nothing in it is a gap
    // above the Add a photo link.
    const { container } = await renderWithRouter(form());
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll(".grid-cols-4")).toHaveLength(0);
  });

  it("shows the grid as soon as there is one photo", async () => {
    const { container } = await renderWithRouter(
      form({ entry: { photoKeys: ["a"] } }),
    );
    expect(container.querySelectorAll(".grid-cols-4")).toHaveLength(1);
  });

  it("uploads a photo as multipart, with its own idempotency key", async () => {
    // One key per file, not per submission: each photo is its own create.
    const user = userEvent.setup();
    const uploadPhoto = vi.fn<
      (input: { data: FormData }) => Promise<{ key: string }>
    >(() => Promise.resolve({ key: "new-key" }));
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
    const sent = uploadPhoto.mock.calls[0]?.[0]?.data;
    expect(sent?.get("entryId")).toBe("01JENTRY000000000000000000");
    expect(sent?.get("photo")).toBeInstanceOf(File);
    expect(typeof sent?.get("idempotencyKey")).toBe("string");
  });

  it("adds the uploaded photo to the grid", async () => {
    const user = userEvent.setup();
    const { container } = await renderWithRouter(
      form({ uploadPhoto: () => Promise.resolve({ key: "new-key" }) }),
    );

    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(container.querySelectorAll("img")).toHaveLength(1);
    });
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/feed/photo/new-key",
    );
  });

  it("uploads several at once, each with its own key", async () => {
    const user = userEvent.setup();
    const keys: unknown[] = [];
    const uploadPhoto = vi.fn((input: { data: FormData }) => {
      keys.push(input.data.get("idempotencyKey"));
      return Promise.resolve({ key: `k${String(keys.length)}` });
    });
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(fileInput(), [jpeg("a.jpg"), jpeg("b.jpg")]);

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(2);
    });
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("refuses a type the server would refuse", async () => {
    // `applyAccept: false` so the file reaches the handler: the `accept`
    // attribute is a hint the browser may honour, and the check in the
    // handler is the one that has to hold.
    const user = userEvent.setup({ applyAccept: false });
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(
      fileInput(),
      new File(["x"], "a.gif", { type: "image/gif" }),
    );

    expect(
      await screen.findByText("Photos must be JPEG, PNG, or WebP."),
    ).toBeVisible();
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("keeps going past a refused file to the ones that are fine", async () => {
    // `continue`, not `break`: one bad file in a multi-select should not
    // silently drop the rest.
    const user = userEvent.setup({ applyAccept: false });
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(fileInput(), [
      new File(["x"], "a.gif", { type: "image/gif" }),
      jpeg("b.jpg"),
    ]);

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
  });

  it("stops at the cap, and says why", async () => {
    const user = userEvent.setup();
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    await renderWithRouter(
      form({
        entry: {
          photoKeys: Array.from({ length: maxPhotosPerEntry - 1 }, (_, i) =>
            String(i),
          ),
        },
        uploadPhoto,
      }),
    );

    await user.upload(fileInput(), [jpeg("a.jpg"), jpeg("b.jpg")]);

    // At the cap the Add-a-photo control is gone — and the sentence
    // explaining why has to outlive it, which is the whole point of the
    // field rendering when there is an error but no control.
    await waitFor(() => {
      expect(screen.queryByLabelText("Add a photo")).toBeNull();
    });
    expect(
      await screen.findByText(
        `Up to ${String(maxPhotosPerEntry)} photos per entry.`,
      ),
    ).toBeVisible();
    // The first went up; the second hit the cap.
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
  });

  it("hides the picker entirely once the entry is full", async () => {
    const { container } = await renderWithRouter(
      form({
        entry: {
          photoKeys: Array.from({ length: maxPhotosPerEntry }, (_, i) =>
            String(i),
          ),
        },
      }),
    );
    expect(container.querySelectorAll("input[type='file']")).toHaveLength(0);
  });

  it("says so when an upload fails", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({ uploadPhoto: () => Promise.reject(new Error("R2 unavailable")) }),
    );

    await user.upload(fileInput(), jpeg());

    expect(
      await screen.findByText("Couldn't upload that photo. Try again."),
    ).toBeVisible();
  });

  it("says it is uploading while it works, and stops after", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ key: string }>();
    await renderWithRouter(form({ uploadPhoto: () => pending.promise }));

    await user.upload(fileInput(), jpeg());

    expect(await screen.findByText("Uploading…")).toBeVisible();
    pending.resolve({ key: "k" });
    await waitFor(() => {
      expect(screen.getByText("Add a photo")).toBeVisible();
    });
  });

  it("does nothing when the picker is dismissed", async () => {
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    await renderWithRouter(form({ uploadPhoto }));

    fileInput().dispatchEvent(new Event("change", { bubbles: true }));

    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("says nothing at rest", async () => {
    const { container } = await renderWithRouter(form());
    expect(container.querySelectorAll("p.text-pink")).toHaveLength(0);
  });

  it("clears the last photo message when a new one is picked", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const pending = Promise.withResolvers<{ key: string }>();
    const uploadPhoto = vi
      .fn<() => Promise<{ key: string }>>()
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(
      fileInput(),
      new File(["x"], "a.gif", { type: "image/gif" }),
    );
    expect(
      await screen.findByText("Photos must be JPEG, PNG, or WebP."),
    ).toBeVisible();

    await user.upload(fileInput(), jpeg("b.jpg"));

    await waitFor(() => {
      expect(
        screen.queryByText("Photos must be JPEG, PNG, or WebP."),
      ).toBeNull();
    });
    pending.resolve({ key: "k" });
  });
});

describe("VerdictForm: what happens after saving", () => {
  it("tells them what the run just did to a piece's record", async () => {
    // The point of the whole screen: a verdict is data about a garment in
    // a temperature band, and this is where the runner sees it land.
    const user = userEvent.setup();
    const itemBandWearStat = vi.fn(() =>
      Promise.resolve({ worn: 3, total: 5 }),
    );
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        bandFloor: 5,
        itemBandWearStat,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    expect(await screen.findByText("Houdini is now 3 of 5")).toBeVisible();
    expect(screen.getByText("[Noted]")).toBeVisible();
    expect(itemBandWearStat).toHaveBeenCalledWith({
      data: { itemId: "01JTEMA0000000000000000000", bandFloorC: 5 },
    });
  });

  it("goes straight to the entry when there is no band to count in", async () => {
    const user = userEvent.setup();
    const itemBandWearStat = vi.fn(() => Promise.resolve({ worn: 1, total: 1 }));
    const { router } = await renderWithRouter(
      form({ entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] }, itemBandWearStat }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/feed/entry/01JENTRY000000000000000000");
    });
    expect(itemBandWearStat).not.toHaveBeenCalled();
  });

  it("goes straight there when the entry has no items either", async () => {
    const user = userEvent.setup();
    const { router } = await renderWithRouter(form({ bandFloor: 5 }));

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/feed/entry/01JENTRY000000000000000000");
    });
  });

  it("moves on from the noted screen when asked", async () => {
    const user = userEvent.setup();
    const { router } = await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        bandFloor: 5,
        itemBandWearStat: () => Promise.resolve({ worn: 3, total: 5 }),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));
    await screen.findByText("Houdini is now 3 of 5");

    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/feed/entry/01JENTRY000000000000000000");
    });
  });

  it("says so when the save fails, and leaves the form standing", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({ submitVerdict: () => Promise.reject(new Error("D1 unavailable")) }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    // The band the contract defines, with the classifier's own sentence —
    // not a pink line of the form's own wording. Pink is action, never
    // failure.
    expect(
      await screen.findByText("Our end failed. Nothing changed."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save verdict" })).toBeVisible();
  });

  it("clears the last failure on the next attempt", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<unknown>();
    const submitVerdict = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("D1 unavailable"))
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(form({ submitVerdict }));

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));
    expect(
      await screen.findByText("Our end failed. Nothing changed."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(screen.queryByText("Our end failed. Nothing changed.")).toBeNull();
    });
    pending.resolve(undefined);
  });
});

describe("VerdictForm: the details that go missing silently", () => {
  it("offers the control at rest and withdraws it at the cap", async () => {
    // Three things at once, because they are one decision: the field
    // renders when there is a control *or* a message, the control itself
    // renders only below the cap, and the resting label is the words a
    // person taps. At the cap with nothing wrong there is no control and
    // nothing to say, so the whole field goes — anything else leaves an
    // "Add a photo" heading over empty space.
    await renderWithRouter(form());
    expect(screen.getByText("Add a photo")).toBeVisible();

    cleanup();

    await renderWithRouter(
      form({
        entry: {
          photoKeys: Array.from({ length: maxPhotosPerEntry }, (_, i) =>
            String(i),
          ),
        },
      }),
    );
    expect(screen.queryByText("Add a photo")).toBeNull();
  });

  it("says it is busy on the control, and starts one upload at a time", async () => {
    // Both halves of what the `disabled` attribute used to do, done the
    // way §5 requires: the input stays focusable and announces that work
    // is under way, and the re-entry guard lives in the handler. A second
    // selection mid-upload would race the cap count, which is counted
    // locally precisely because state does not settle between iterations.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ key: string }>();
    const uploadPhoto = vi.fn(() => pending.promise);
    await renderWithRouter(form({ uploadPhoto }));

    const input = fileInput();
    expect(input).not.toHaveAttribute("aria-busy");

    await user.upload(input, [jpeg("a.jpg")]);

    await waitFor(() => {
      expect(fileInput()).toHaveAttribute("aria-busy", "true");
    });
    // Still focusable, which a `disabled` input would not be.
    expect(fileInput()).toBeEnabled();

    await user.upload(fileInput(), [jpeg("b.jpg")]);
    expect(uploadPhoto).toHaveBeenCalledTimes(1);

    pending.resolve({ key: "k" });
    await waitFor(() => {
      expect(fileInput()).not.toHaveAttribute("aria-busy");
    });
  });

  it("says it is uploading while it uploads", async () => {
    // The label swaps for the duration, and nothing else on the screen
    // says work is under way — a photo that takes a moment would otherwise
    // look like a tap that did not register.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ key: string }>();
    await renderWithRouter(form({ uploadPhoto: () => pending.promise }));

    await user.upload(fileInput(), [jpeg("a.jpg")]);

    expect(await screen.findByText("Uploading…")).toBeVisible();
    pending.resolve({ key: "k" });
    await waitFor(() => {
      expect(screen.queryByText("Uploading…")).toBeNull();
    });
  });

  it("submits through its own handler, never the browser's", async () => {
    // `event.preventDefault()`. Without it the browser navigates on submit
    // and the whole hook — validation, announcement, band — is skipped,
    // while the screen appears to do something.
    const user = userEvent.setup();
    await renderWithRouter(form());
    await user.click(screen.getByRole("button", { name: "Dialed" }));

    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(screen.getByRole("button", { name: "Save verdict" }));
    } finally {
      document.removeEventListener("submit", watch);
    }

    expect(prevented).toBe(true);
  });

  it("announces the save before either exit destroys the region", async () => {
    // Both success paths take the live region with them — one navigates,
    // the other replaces the form with the noted screen — so the sentence
    // cannot be read after the fact. It is observable in exactly one
    // window: `onSuccess` has set the status and is awaiting the band
    // stat, so the form is still mounted with the region filled. Holding
    // that promise open is what makes the window big enough to assert in.
    //
    // That the window exists at all is D-44's fix: before it, the status
    // and the unmount landed in the same commit.
    const user = userEvent.setup();
    const stat = Promise.withResolvers<{ worn: number; total: number }>();
    await renderWithRouter(
      form({
        bandFloor: -5,
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        itemBandWearStat: () => stat.promise,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Verdict saved.");
    });

    stat.resolve({ worn: 3, total: 7 });
    expect(await screen.findByText(/Houdini is now 3 of 7/)).toBeVisible();
  });
});
