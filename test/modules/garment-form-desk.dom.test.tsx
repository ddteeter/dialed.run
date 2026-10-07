import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GarmentForm } from "../../src/modules/closet/components/GarmentForm";
import type { GarmentFormProps } from "../../src/modules/closet/components/GarmentForm";
import { itemView, wardrobeItem } from "./closet-fixtures";

/**
 * F's frame: the heading and the way back it is handed, round 26 #10's
 * split at the desk with its one rail card, and the saved state's own
 * guards.
 */

type Upload = GarmentFormProps["photo"]["upload"];

const rover = itemView({
  item: wardrobeItem({ id: "01ROV", name: "Rover Half-zip", brand: "Janji" }),
  isGeneric: false,
});
const shorts = itemView({
  item: wardrobeItem({ id: "01SH", name: "Split shorts", category: "bottom" }),
});

function renderForm(overrides: Partial<GarmentFormProps> = {}) {
  const onSaved = vi.fn<GarmentFormProps["onSaved"]>(() => Promise.resolve());
  render(
    <GarmentForm
      heading="Add a garment"
      save={() => Promise.resolve({ id: "01SAVED" })}
      onSaved={onSaved}
      submitLabel="Add to closet"
      pendingLabel="Adding"
      successMessage="Added."
      photo={{
        upload: () => Promise.resolve({ ok: true }),
        remove: () => Promise.resolve(),
      }}
      {...overrides}
    />,
  );
  return { onSaved };
}

function primary(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-part='primary']");
  if (element === null) throw new Error("no primary column");
  return element;
}

/**
A re-read nothing here should ask for: the rail is only read again after a
save F keeps (R-114), which these tests do not reach.
*/
function neverReread(): Promise<never> {
  return Promise.reject(new Error("the rail was read again"));
}

function rail(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-part='rail']");
}

function png(name: string): File {
  return new File(["x"], name, { type: "image/png" });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector("input[type='file']");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  return input;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GarmentForm: its frame", () => {
  it("heads the page with what it is handed, under the way back", () => {
    renderForm({ back: <a href="#closet">Closet</a> });

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Add a garment",
    });
    expect(heading).toBeVisible();
    // The form's own heading carries no saved-state marker — that is the
    // saved view's alone (test/modules/garment-form-photo.dom.test.tsx).
    expect(heading).not.toHaveAttribute("data-state");
    const back = screen.getByRole("link", { name: "Closet" });
    expect(
      back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is the panel it always was with no closet to show beside it", () => {
    renderForm();

    expect(rail()).toBeNull();
    expect(primary()).toHaveClass("mx-auto", "max-w-panel");
    expect(primary()).not.toHaveClass("wide:max-w-column");
  });
});

describe("GarmentForm at the desk (round 26 #10)", () => {
  it("splits, with the category's pieces in the one rail card", () => {
    renderForm({
      rail: {
        nearby: { byCategory: { top: [rover], bottom: [shorts] }, byType: {} },
        reread: neverReread,
      },
    });

    const card = rail();
    if (card === null) throw new Error("no rail");
    expect(
      within(card).getByRole("heading", {
        name: "Already in your closet · Top",
      }),
    ).toBeInTheDocument();
    expect(within(card).getByText("Janji Rover Half-zip")).toBeInTheDocument();
    expect(within(card).queryByText("Split shorts")).toBeNull();
    // DS1's primary column: 620 at most, set to the left beside the rail.
    expect(primary()).toHaveClass("wide:mx-0", "wide:max-w-column");
  });

  it("follows the category as it is picked", async () => {
    const user = userEvent.setup();
    renderForm({
      rail: {
        nearby: { byCategory: { top: [rover], bottom: [shorts] }, byType: {} },
        reread: neverReread,
      },
    });

    await user.selectOptions(screen.getByLabelText("Category"), "bottom");

    const card = rail();
    if (card === null) throw new Error("no rail");
    expect(
      within(card).getByRole("heading", {
        name: "Already in your closet · Bottom",
      }),
    ).toBeInTheDocument();
    expect(within(card).getByText("Split shorts")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Category"), "shoes");
    expect(within(card).getByText("No shoes yet.")).toBeInTheDocument();
  });

  it("marks the piece being typed again as SAME NAME", async () => {
    const user = userEvent.setup();
    renderForm({
      rail: {
        nearby: { byCategory: { top: [rover] }, byType: {} },
        reread: neverReread,
      },
    });

    await user.type(screen.getByLabelText("Brand"), "Janji");
    await user.type(screen.getByLabelText(/Model \/ name/), "Rover half-zip");

    const card = rail();
    if (card === null) throw new Error("no rail");
    expect(within(card).getByText("Same name")).toBeInTheDocument();
  });
});

const halfZip = itemView({
  item: wardrobeItem({ id: "01HZ", name: "Old half-zip", type: "halfZip" }),
});

function railCard(): HTMLElement {
  const card = rail();
  if (card === null) throw new Error("no rail");
  return card;
}

describe("GarmentForm's TYPE (round 26 #10, D-75, R-112)", () => {
  it("offers the category's types, from the contract, in its order", () => {
    renderForm();

    const group = screen.getByRole("group", { name: "Type" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toStrictEqual([
      "Singlet",
      "Tee",
      "L/S crew",
      "Half-zip",
      "Jacket",
      "Vest",
      "Sports bra",
    ]);
    expect(within(group).queryByRole("radio", { checked: true })).toBeNull();
  });

  it("asks nothing where a category has one type", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText("Category"), "shoes");

    expect(screen.queryByRole("group", { name: "Type" })).toBeNull();
  });

  it("narrows the rail to the picked type, by its name", async () => {
    const user = userEvent.setup();
    renderForm({
      rail: {
        nearby: {
          byCategory: { top: [rover] },
          byType: { halfZip: [halfZip] },
        },
        reread: neverReread,
      },
    });

    await user.click(screen.getByRole("radio", { name: "Half-zip" }));

    expect(
      within(railCard()).getByRole("heading", {
        name: "Already in your closet · Top · Half-zip",
      }),
    ).toBeInTheDocument();
    expect(within(railCard()).getByText("Old half-zip")).toBeInTheDocument();
    expect(within(railCard()).queryByText("Janji Rover Half-zip")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Tee" }));
    expect(within(railCard()).getByText("No tees yet.")).toBeInTheDocument();
  });

  it("clears the type when the category changes, since a type has one", async () => {
    const user = userEvent.setup();
    const save = vi.fn<GarmentFormProps["save"]>(() =>
      Promise.resolve({ id: "01SAVED" }),
    );
    renderForm({
      save,
      initial: { name: "Split" },
      rail: {
        nearby: { byCategory: { top: [rover] }, byType: {} },
        reread: neverReread,
      },
    });

    await user.click(screen.getByRole("radio", { name: "Half-zip" }));
    await user.selectOptions(screen.getByLabelText("Category"), "bottom");
    await user.selectOptions(screen.getByLabelText("Category"), "top");

    expect(
      within(screen.getByRole("group", { name: "Type" })).queryByRole("radio", {
        checked: true,
      }),
    ).toBeNull();
    expect(
      within(railCard()).getByRole("heading", {
        name: "Already in your closet · Top",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to closet" }));
    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    expect(Object.hasOwn(save.mock.calls[0]?.[0] ?? {}, "type")).toBe(false);
  });

  it("saves the picked type with the garment", async () => {
    const user = userEvent.setup();
    const save = vi.fn<GarmentFormProps["save"]>(() =>
      Promise.resolve({ id: "01SAVED" }),
    );
    renderForm({ save, initial: { name: "Rover" } });

    await user.click(screen.getByRole("radio", { name: "Half-zip" }));
    await user.click(screen.getByRole("button", { name: "Add to closet" }));

    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      category: "top",
      type: "halfZip",
    });
  });
});

/**
 * A half-zip saved through F whose photo the server refuses: F stays, as
 * the saved garment's page (round 26 #4).
 */
async function refuseThePhoto(overrides: Partial<GarmentFormProps>) {
  const user = userEvent.setup();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
  renderForm({
    initial: { name: "Rover Half-zip", brand: "Janji" },
    photo: {
      upload: () => Promise.resolve({ ok: false, error: "Too big." }),
      remove: () => Promise.resolve(),
    },
    ...overrides,
  });
  await user.click(screen.getByRole("radio", { name: "Half-zip" }));
  await user.upload(fileInput(), png("kit.png"));
  await user.click(screen.getByRole("button", { name: "Add to closet" }));
  await screen.findByRole("button", { name: "Done" });
}

describe("GarmentForm, saved with its photo refused: the rail (R-114)", () => {
  it("reads the rail again, so it lists the piece the save made", async () => {
    const saved = itemView({
      item: wardrobeItem({
        id: "01SAVED",
        name: "Rover Half-zip",
        brand: "Janji",
        type: "halfZip",
      }),
      isGeneric: false,
    });
    const rereadNearby = vi.fn(() =>
      Promise.resolve({
        byCategory: { top: [saved] },
        byType: { halfZip: [saved] },
      }),
    );

    await refuseThePhoto({
      rail: { nearby: { byCategory: {}, byType: {} }, reread: rereadNearby },
    });

    expect(
      await within(railCard()).findByText("Janji Rover Half-zip"),
    ).toBeInTheDocument();
    expect(rereadNearby).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saved to closet · Top · Half-zip")).toBeVisible();
  });

  it("keeps the rows it had when the re-read fails", async () => {
    await refuseThePhoto({
      rail: {
        nearby: { byCategory: {}, byType: { halfZip: [halfZip] } },
        reread: () => Promise.reject(new TypeError("Failed to fetch")),
      },
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(within(railCard()).getByText("Old half-zip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeVisible();
  });
});

describe("GarmentForm, saved with its photo refused", () => {
  it("sends the photo once when Try again is pressed twice, busy while it goes", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const retry = Promise.withResolvers<{ ok: true }>();
    const upload = vi
      .fn<Upload>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(retry.promise);
    const { onSaved } = renderForm({
      initial: { name: "Harrier" },
      photo: { upload, remove: () => Promise.resolve() },
    });

    await user.upload(fileInput(), png("kit.png"));
    await user.click(screen.getByRole("button", { name: "Add to closet" }));
    const again = await screen.findByRole("button", { name: "Try again" });
    await user.click(again);
    await user.click(again);

    await waitFor(() => {
      expect(
        document.querySelector("[data-part='photo-well']"),
      ).toHaveAttribute("data-state", "uploading");
    });
    expect(upload).toHaveBeenCalledTimes(2);

    await act(async () => {
      retry.resolve({ ok: true });
      await retry.promise;
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });
});
