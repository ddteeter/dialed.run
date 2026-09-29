import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GarmentForm } from "../../src/modules/closet/components/GarmentForm";
import type { GarmentFormProps } from "../../src/modules/closet/components/GarmentForm";

/**
 * F's photo well (round 22, items 8 and 17): the last thing before the
 * save, in add and in edit alike.
 *
 * The photo is part of the form, so nothing about it is written until the
 * save — and the save writes it after the row, because the add form has
 * no id to attach a photo to before then.
 */

type Photo = GarmentFormProps["photo"];
type Upload = Photo["upload"];
type RemovePhoto = Photo["remove"];

function renderForm(
  photo: Partial<Photo> = {},
  overrides: Partial<GarmentFormProps> = {},
) {
  const calls: string[] = [];
  const save = vi.fn<GarmentFormProps["save"]>(() => {
    calls.push("save");
    return Promise.resolve({ id: "01SAVED" });
  });
  const uploadPhoto = vi.fn<Upload>(() => {
    calls.push("upload");
    return Promise.resolve({ ok: true });
  });
  const removePhoto = vi.fn<RemovePhoto>(() => {
    calls.push("remove");
    return Promise.resolve();
  });
  const onSaved = vi.fn<GarmentFormProps["onSaved"]>(() => Promise.resolve());
  render(
    <GarmentForm
      heading="Add a garment"
      save={save}
      onSaved={onSaved}
      submitLabel="Save"
      pendingLabel="Saving"
      successMessage="Saved."
      photo={{ upload: uploadPhoto, remove: removePhoto, ...photo }}
      initial={{ name: "Harrier" }}
      {...overrides}
    />,
  );
  return { calls, save, uploadPhoto, removePhoto, onSaved };
}

function well(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    "[data-part='photo-well']",
  );
  if (element === null) throw new Error("no photo well");
  return element;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector("input[type='file']");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  return input;
}

function png(name = "kit.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GarmentForm: the photo well at rest", () => {
  it("is round 22's well, with its words, and says Drop at desk", () => {
    renderForm();

    expect(well()).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("Photo · optional")).toBeVisible();
    expect(screen.getByText("Add a photo")).toHaveClass("wide:hidden");
    expect(screen.getByText("Drop a photo, or browse")).toHaveClass(
      "hidden",
      "wide:inline",
    );
    expect(
      screen.getByText("Flat on the floor works best. JPG, PNG or WebP."),
    ).toBeVisible();
    expect(fileInput()).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
  });

  it("previews a stored photo under the garment's name, with Replace and Remove", () => {
    renderForm({ url: "/closet/photo/01ITEM/card" });

    expect(well()).toHaveAttribute("data-state", "filled");
    expect(screen.getByRole("img", { name: "Harrier" })).toHaveAttribute(
      "src",
      "/closet/photo/01ITEM/card",
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
  });
});

describe("GarmentForm: a picked photo", () => {
  it("is held and previewed, and uploaded only after the save made the row", async () => {
    const user = userEvent.setup();
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const { calls, uploadPhoto, onSaved } = renderForm();

    await user.upload(fileInput(), png("kit.png"));

    expect(created).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img", { name: "Harrier" })).toHaveAttribute(
      "src",
      "blob:1",
    );
    expect(uploadPhoto).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: "01SAVED" });
    });
    expect(calls).toStrictEqual(["save", "upload"]);
    const sent = uploadPhoto.mock.calls[0]?.[0].data;
    expect(sent?.get("itemId")).toBe("01SAVED");
    expect((sent?.get("photo") as File).name).toBe("kit.png");
  });

  it("writes nothing about a photo when none was picked", async () => {
    const user = userEvent.setup();
    const { calls, onSaved } = renderForm();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(calls).toStrictEqual(["save"]);
  });

  it("does nothing when the picker is dismissed", () => {
    renderForm();

    fileInput().dispatchEvent(new Event("change", { bubbles: true }));

    expect(well()).toHaveAttribute("data-state", "empty");
  });

  it("opens no step when the picker is dismissed", () => {
    const step = vi.fn<NonNullable<Photo["renderStep"]>>();
    renderForm({ renderStep: step });

    fileInput().dispatchEvent(new Event("change", { bubbles: true }));

    expect(step).not.toHaveBeenCalled();
    expect(well()).toHaveAttribute("data-state", "empty");
  });

  it("does nothing, and throws nothing, for an input with no file list at all", () => {
    renderForm();
    const input = fileInput();
    // The literal is a lint error, so the null is parsed into being.
    Object.defineProperty(input, "files", {
      value: z.null().parse(JSON.parse("null")),
    });
    const thrown: unknown[] = [];
    const record = (event: ErrorEvent) => {
      thrown.push(event.error);
      event.preventDefault();
    };
    globalThis.addEventListener("error", record);

    try {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } finally {
      globalThis.removeEventListener("error", record);
    }

    expect(thrown).toStrictEqual([]);
    expect(well()).toHaveAttribute("data-state", "empty");
  });

  it("says to let go while a file is over it", () => {
    renderForm();

    const transfer = new DataTransfer();
    transfer.items.add(png());
    fireEvent.dragOver(well(), { dataTransfer: transfer });

    expect(well()).toHaveAttribute("data-state", "drag-over");
    expect(within(well()).getByText("Let go to add it")).toBeVisible();
  });

  it("goes through W3's step first, and keeps the bytes the step hands back", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:blurred");
    let hand: ((ready: File) => void) | undefined;
    const { uploadPhoto, onSaved } = renderForm({
      renderStep: (file, onReady, announce) => {
        hand = onReady;
        return (
          <button
            type="button"
            onClick={() => {
              announce("Blurred 1 face.");
            }}
          >
            Step for {file.name}
          </button>
        );
      },
    });

    await user.upload(fileInput(), png("face.png"));
    // Busy while the step decides, and says so.
    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(within(well()).getByText("Adding")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Step for face.png" }));
    expect(screen.getByRole("status")).toHaveTextContent("Blurred 1 face.");

    const blurred = new File(["blurred"], "face.png", { type: "image/png" });
    act(() => {
      hand?.(blurred);
    });
    expect(screen.queryByRole("button", { name: /Step for/ })).toBeNull();
    expect(screen.getByRole("img", { name: "Harrier" })).toHaveAttribute(
      "src",
      "blob:blurred",
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(uploadPhoto.mock.calls[0]?.[0].data.get("photo")).toBe(blurred);
  });

  it("shows the upload in the well while the save carries it, and only then", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const pending = Promise.withResolvers<{ ok: true }>();
    renderForm({ upload: () => pending.promise });

    await user.upload(fileInput(), png());
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(well()).toHaveAttribute("data-state", "uploading");
    });
    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
  });

  it("leaves the well at rest while a save with no photo is in flight", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ id: string }>();
    renderForm({}, { save: () => pending.promise });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(well()).toHaveAttribute("data-state", "empty");
    await act(async () => {
      pending.resolve({ id: "01SAVED" });
      await pending.promise;
    });
  });

  it("becomes the saved garment when the photo is refused: fields gone, the reason, Pick another only", async () => {
    // Round 26 #4. The save is not undone and not repeated.
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const { onSaved, save } = renderForm(
      {
        upload: () =>
          Promise.resolve({
            ok: false,
            error: "IMG_2231.HEIC isn't a JPG, PNG or WebP.",
          }),
      },
      { initial: { name: "Rover Half-zip", brand: "Janji" } },
    );

    await user.upload(fileInput(), png());
    await user.click(screen.getByRole("button", { name: "Save" }));

    const band = await screen.findByText("Photo not added");
    const region = band.closest("[data-part='failure-band']");
    expect(region).toHaveTextContent("Garment saved, photo didn't. Try again?");
    expect(region).toHaveTextContent("IMG_2231.HEIC isn't a JPG, PNG or WebP.");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Garment saved, photo didn't. Try again?",
      );
    });
    // The fields have gone, because the row exists.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByLabelText(/Model \/ name/)).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Janji Rover Half-zip" }),
    ).toBeVisible();
    expect(screen.getByText("Saved to closet · Top")).toHaveClass(
      "text-dialed-text",
    );
    // A refusal would refuse the same file again: another file is the fix.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByLabelText("Pick another")).toHaveAttribute(
      "type",
      "file",
    );
    // The well is empty again, and marks nothing: the reason is the band's.
    expect(well()).toHaveAttribute("data-state", "empty");
    expect(onSaved).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("names a piece with no brand by its name alone", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    renderForm({
      upload: () =>
        Promise.resolve({ ok: false, error: "Photo file is empty." }),
    });

    await user.upload(fileInput(), png());
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Harrier" }),
    ).toBeVisible();
  });

  it("offers Try again for a dropped connection, and it re-sends the same file", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const upload = vi
      .fn<Upload>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true });
    const { onSaved, save } = renderForm({ upload });

    await user.upload(fileInput(), png("kit.png"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const band = await screen.findByText("Photo not added");
    expect(band.closest("[data-part='failure-band']")).toHaveTextContent(
      "Your connection dropped.",
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: "01SAVED" });
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(2);
    const retried = upload.mock.calls[1]?.[0].data;
    expect(retried?.get("itemId")).toBe("01SAVED");
    expect((retried?.get("photo") as File | null)?.name).toBe("kit.png");
  });

  it("offers no Try again when our end failed rather than the connection", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    renderForm({ upload: () => Promise.reject(new Error("R2 down")) });

    await user.upload(fileInput(), png());
    await user.click(screen.getByRole("button", { name: "Save" }));

    const band = await screen.findByText("Photo not added");
    expect(band.closest("[data-part='failure-band']")).toHaveTextContent(
      "Our end failed. Nothing changed.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("sends another photo straight to the saved garment, and moves on", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const upload = vi
      .fn<Upload>()
      .mockResolvedValueOnce({ ok: false, error: "Photo file is empty." })
      .mockResolvedValueOnce({ ok: true });
    const { onSaved, save } = renderForm({ upload });

    await user.upload(fileInput(), png());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Photo not added");

    await user.upload(screen.getByLabelText("Pick another"), png("other.png"));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: "01SAVED" });
    });
    expect(save).toHaveBeenCalledTimes(1);
    const sent = upload.mock.calls[1]?.[0].data;
    expect(sent?.get("itemId")).toBe("01SAVED");
    expect((sent?.get("photo") as File | null)?.name).toBe("other.png");
  });

  it("takes a photo dropped on the saved garment's well the same way", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const upload = vi
      .fn<Upload>()
      .mockResolvedValueOnce({ ok: false, error: "Photo file is empty." })
      .mockResolvedValueOnce({ ok: true });
    const { onSaved } = renderForm({ upload });

    await user.upload(fileInput(), png());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Photo not added");
    await user.upload(fileInput(), png("again.png"));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: "01SAVED" });
    });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("keeps the band when the next photo is refused too, with its reason", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const upload = vi
      .fn<Upload>()
      .mockResolvedValueOnce({ ok: false, error: "Photo file is empty." })
      .mockResolvedValueOnce({
        ok: false,
        error: "Photo must be 10 MB or smaller.",
      });
    const { onSaved } = renderForm({ upload });

    await user.upload(fileInput(), png());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Photo not added");
    await user.upload(screen.getByLabelText("Pick another"), png("big.png"));

    expect(
      await screen.findByText("Photo must be 10 MB or smaller."),
    ).toBeVisible();
    expect(screen.queryByText("Photo file is empty.")).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("goes to the garment on Done, with its photo still owed", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const { onSaved } = renderForm({
      upload: () =>
        Promise.resolve({ ok: false, error: "Photo file is empty." }),
    });

    await user.upload(fileInput(), png());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Photo not added");
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onSaved).toHaveBeenCalledExactlyOnceWith({ id: "01SAVED" });
  });

  it("drops a held photo on Remove, and lets its preview go", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:1");
    const revoked = vi.spyOn(URL, "revokeObjectURL");
    const { calls, onSaved } = renderForm();

    await user.upload(fileInput(), png());
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(well()).toHaveAttribute("data-state", "empty");
    expect(revoked).toHaveBeenCalledWith("blob:1");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    // An add form has no stored photo to remove.
    expect(calls).toStrictEqual(["save"]);
  });
});

describe("GarmentForm: editing a garment that has a photo", () => {
  it("keeps the emptied well at rest while the stored photo is being removed", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    const remove = vi.fn<RemovePhoto>(() => pending.promise);
    renderForm({ url: "/closet/photo/01ITEM/card", remove });

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(remove).toHaveBeenCalled();
    });
    expect(well()).toHaveAttribute("data-state", "empty");
    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
  });

  it("removes the stored photo on Save, after the row is written", async () => {
    const user = userEvent.setup();
    const { calls, removePhoto, onSaved } = renderForm({
      url: "/closet/photo/01ITEM/card",
    });

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(well()).toHaveAttribute("data-state", "empty");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(calls).toStrictEqual(["save", "remove"]);
    expect(removePhoto).toHaveBeenCalledWith({ data: { itemId: "01SAVED" } });
  });

  it("keeps the stored photo when nothing was changed", async () => {
    const user = userEvent.setup();
    const { calls, onSaved } = renderForm({
      url: "/closet/photo/01ITEM/card",
    });

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(calls).toStrictEqual(["save"]);
  });

  it("uploads a replacement rather than removing anything", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:new");
    const revoked = vi.spyOn(URL, "revokeObjectURL");
    const { calls, onSaved } = renderForm({
      url: "/closet/photo/01ITEM/card",
    });

    await user.upload(screen.getByLabelText("Replace"), png("new.png"));
    expect(screen.getByRole("img", { name: "Harrier" })).toHaveAttribute(
      "src",
      "blob:new",
    );
    expect(revoked).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(calls).toStrictEqual(["save", "upload"]);
  });
});
