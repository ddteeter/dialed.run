import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EMAIL_UNCONFIRMED_CODE } from "../../src/lib/auth-signal";
import {
  CorrectionSheet,
  NoteCounter,
  valueLabel,
  type CorrectionContextRow,
  type CorrectionSheetProps,
} from "../../src/modules/closet/components/CorrectionSheet";
import type { ConfirmGate } from "../../src/ui";
import { UnconfirmedRefusalAnswer } from "../../src/ui/unconfirmed-refusal";
import { carriedSince } from "../ui/carry-spy";

vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
  const { spyOnCarry } = await import("../ui/carry-spy");
  return spyOnCarry(await importOriginal());
});

const PRODUCT = "01HZZZZZZZZZZZZZZZZZZZZZZP";
const GARMENT = "01HZZZZZZZZZZZZZZZZZZZZZZG";

const CONTEXT: CorrectionContextRow = {
  brandName: "Janji",
  productName: "AFO Middle Layer",
  current: { weight: "mid", name: "AFO Middle Layer" },
  waiting: [],
};

function renderSheet(overrides: Partial<CorrectionSheetProps> = {}) {
  const loadContext = vi
    .fn<CorrectionSheetProps["loadContext"]>()
    .mockResolvedValue(CONTEXT);
  const fileCorrection = vi
    .fn<CorrectionSheetProps["fileCorrection"]>()
    .mockResolvedValue(undefined);
  const onClose = vi.fn();
  const confirmFirst = vi.fn<ConfirmGate["sheet"]>();
  render(
    <UnconfirmedRefusalAnswer gate={{ sheet: confirmFirst }}>
      <CorrectionSheet
        open
        onClose={onClose}
        subject={{ productId: PRODUCT, garmentId: GARMENT }}
        loadContext={loadContext}
        fileCorrection={fileCorrection}
        {...overrides}
      />
    </UnconfirmedRefusalAnswer>,
  );
  return { loadContext, fileCorrection, onClose, confirmFirst };
}

describe("WRONG?'s sheet (R48·129)", () => {
  it("asks what's wrong, names the product once it has read it, and says what it changes", async () => {
    const { loadContext } = renderSheet();
    expect(
      screen.getByRole("heading", { name: "What's wrong with it?" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "This fixes it for every runner. Your own garment keeps what you entered.",
      ),
    ).toBeVisible();
    expect(await screen.findByText("Janji · AFO Middle Layer")).toBeVisible();
    expect(loadContext).toHaveBeenCalledWith({ data: { productId: PRODUCT } });
  });

  it("offers the seven fields, and no value input until one is picked", () => {
    renderSheet();
    const group = screen.getByRole("group", { name: "Field" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toStrictEqual([
      "Name",
      "Weight",
      "Fabric",
      "Wind",
      "Water",
      "Composition",
      "Link",
    ]);
    expect(screen.queryByLabelText(/It should say/u)).toBeNull();
  });

  it("quotes what the product says now on the value's label", async () => {
    const user = userEvent.setup();
    renderSheet();
    await screen.findByText("Janji · AFO Middle Layer");
    await user.click(screen.getByRole("radio", { name: "Weight" }));
    expect(
      screen.getByRole("combobox", { name: "It says Mid. It should say" }),
    ).toBeVisible();
  });

  it("sends the picked field and value, with the note, and swaps to the receipt", async () => {
    const user = userEvent.setup();
    const { fileCorrection } = renderSheet();
    await user.click(screen.getByRole("radio", { name: "Weight" }));
    await user.selectOptions(screen.getByRole("combobox"), "light");
    await user.type(
      screen.getByRole("textbox", { name: /How do you know/u }),
      "It's on the maker's page.",
    );
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    await waitFor(() => {
      expect(fileCorrection).toHaveBeenCalledOnce();
    });
    expect(fileCorrection.mock.calls[0]?.[0].data).toMatchObject({
      productId: PRODUCT,
      garmentId: GARMENT,
      field: "weight",
      value: "light",
      note: "It's on the maker's page.",
    });
    expect(
      await screen.findByRole("heading", { name: "Thanks. We'll check it." }),
    ).toHaveFocus();
    expect(screen.getByText("Correction sent")).toBeVisible();
    expect(
      screen.getByText(
        "We'll let you know here when it's fixed or if we keep it as it is.",
      ),
    ).toBeVisible();
  });

  it("closes from the receipt's Done", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click(screen.getByRole("radio", { name: "Wind" }));
    await user.click(screen.getByRole("radio", { name: "No" }));
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("sends no note when none is typed", async () => {
    const user = userEvent.setup();
    const { fileCorrection } = renderSheet();
    await user.click(screen.getByRole("radio", { name: "Water" }));
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    await waitFor(() => {
      expect(fileCorrection).toHaveBeenCalledOnce();
    });
    expect(fileCorrection.mock.calls[0]?.[0].data).toMatchObject({
      field: "water",
      value: "yes",
    });
    expect(fileCorrection.mock.calls[0]?.[0].data.note).toBeUndefined();
  });

  it("refuses a missing field and a missing value with the schema's words", async () => {
    const user = userEvent.setup();
    const { fileCorrection } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    expect(fileCorrection).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "Name" }));
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    expect(await screen.findAllByText("Type the name.")).not.toHaveLength(0);
    expect(fileCorrection).not.toHaveBeenCalled();
  });

  it("opens a field with one waiting prefilled, and says sending again replaces it (R48·129c)", async () => {
    const user = userEvent.setup();
    renderSheet({
      loadContext: vi
        .fn<CorrectionSheetProps["loadContext"]>()
        .mockResolvedValue({
          ...CONTEXT,
          waiting: [
            {
              field: "weight",
              value: "light",
              createdAt: Date.UTC(2026, 10, 6, 12) / 1000,
            },
          ],
        }),
    });
    await screen.findByText("Janji · AFO Middle Layer");
    await user.click(screen.getByRole("radio", { name: "Weight" }));
    expect(screen.getByRole("combobox")).toHaveValue("light");
    expect(
      screen.getByText(
        "You sent “Light” for weight on Nov 6. Sending again replaces it.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "Fabric" }));
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByText(/You sent/u)).toBeNull();
  });

  it("is still sendable when its context fails to load (law 5)", async () => {
    const user = userEvent.setup();
    const { fileCorrection } = renderSheet({
      loadContext: vi
        .fn<CorrectionSheetProps["loadContext"]>()
        .mockRejectedValue(new Error("down")),
    });
    await user.click(screen.getByRole("radio", { name: "Link" }));
    expect(
      screen.getByRole("textbox", { name: "It should say" }),
    ).toHaveAttribute("type", "url");
    await user.type(
      screen.getByRole("textbox", { name: "It should say" }),
      "https://janji.com/afo",
    );
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    await waitFor(() => {
      expect(fileCorrection).toHaveBeenCalledOnce();
    });
    expect(screen.queryByText(/Janji/u)).toBeNull();
  });

  it("asks for nothing while closed", () => {
    const { loadContext } = renderSheet({ open: false });
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("opens the root's confirm sheet for an unconfirmed runner (D-113)", async () => {
    const user = userEvent.setup();
    const refusal = Object.assign(new Error("Confirm your email first."), {
      code: EMAIL_UNCONFIRMED_CODE,
    });
    const { confirmFirst } = renderSheet({
      fileCorrection: vi
        .fn<CorrectionSheetProps["fileCorrection"]>()
        .mockRejectedValue(refusal),
    });
    await user.click(screen.getByRole("radio", { name: "Wind" }));
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    await waitFor(() => {
      expect(confirmFirst).toHaveBeenLastCalledWith(
        { open: true, trigger: "correct" },
        expect.any(Function),
      );
    });
    expect(screen.queryByText("Correction sent")).toBeNull();
  });

  it("carries page to log-in on a lapsed session (D-155)", () => {
    carriedSince();
    renderSheet();
    expect(carriedSince()).toEqual(["page"]);
  });
});

describe("the sheet's pieces", () => {
  it("labels a value with nothing to quote plainly", () => {
    expect(valueLabel("water", undefined)).toBe("It should say");
    expect(valueLabel("wind", "yes")).toBe("It says Yes. It should say");
  });

  it("counts the note only from 240 (R48·129c)", () => {
    const { container, rerender } = render(<NoteCounter length={239} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NoteCounter length={240} />);
    expect(container).toHaveTextContent("240/280");
  });
});
