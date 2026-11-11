import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
        subject={{ productId: PRODUCT, garmentId: GARMENT, category: "top" }}
        loadContext={loadContext}
        fileCorrection={fileCorrection}
        {...overrides}
      />
    </UnconfirmedRefusalAnswer>,
  );
  return { loadContext, fileCorrection, onClose, confirmFirst };
}

function fieldsOffered() {
  return within(screen.getByRole("group", { name: "Field" }))
    .getAllByRole("radio")
    .map((radio) => radio.closest("label")?.textContent);
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

  it("offers a top all seven fields, and no value input until one is picked", () => {
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

  it("offers only the fields the piece's category has", () => {
    // A shoe states no weight, fabric or wind: the closet form never asks,
    // so a correction to one would set a fact nothing shows.
    const { unmount } = render(
      <CorrectionSheet
        open
        onClose={vi.fn()}
        subject={{ productId: PRODUCT, garmentId: GARMENT, category: "shoes" }}
        loadContext={vi.fn().mockResolvedValue(CONTEXT)}
        fileCorrection={vi.fn()}
      />,
    );
    expect(fieldsOffered()).toStrictEqual([
      "Name",
      "Water",
      "Composition",
      "Link",
    ]);
    unmount();

    render(
      <CorrectionSheet
        open
        onClose={vi.fn()}
        subject={{
          productId: PRODUCT,
          garmentId: GARMENT,
          category: "accessory",
        }}
        loadContext={vi.fn().mockResolvedValue(CONTEXT)}
        fileCorrection={vi.fn()}
      />,
    );
    expect(fieldsOffered()).toStrictEqual(["Name", "Composition", "Link"]);
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

describe("WRONG?'s sheet, closer", () => {
  it("names the dialog for what it asks, then for the receipt", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(
      screen.getByRole("dialog", { name: "What's wrong with it?" }),
    ).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "Wind" }));
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    expect(await screen.findByText("Correction sent.")).toBeInTheDocument();
    expect(
      await screen.findByRole("dialog", { name: "Correction sent" }),
    ).toBeVisible();
  });

  it("keeps the page where it is on send", () => {
    renderSheet();
    const button = screen.getByRole("button", { name: "Send correction" });
    const form = button.closest("form");
    expect(form).not.toBeNull();
    if (form === null) return;
    expect(fireEvent.submit(form)).toBe(false);
  });

  it("names each field in the summary by its label", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("textbox", { name: /How do you know/u }));
    await user.paste("x".repeat(281));
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    expect(
      await screen.findByRole("button", {
        name: "How do you know? — Keep it to 280 characters.",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Field — /u })).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "Name" }));
    await user.click(screen.getByRole("button", { name: "Send correction" }));
    expect(
      await screen.findByRole("button", {
        name: "It should say — Type the name.",
      }),
    ).toBeVisible();
  });

  it("shows no kicker before the product is read", () => {
    renderSheet({
      loadContext: vi
        .fn<CorrectionSheetProps["loadContext"]>()
        .mockReturnValue(Promise.withResolvers<CorrectionContextRow>().promise),
    });
    expect(screen.queryByText("·")).toBeNull();
    expect(screen.queryByText(/Stryker/u)).toBeNull();
  });

  it("asks again when it opens, and keeps only the latest product's answer", async () => {
    const OTHER = "01HZZZZZZZZZZZZZZZZZZZZZZQ";
    const first = Promise.withResolvers<CorrectionContextRow>();
    const loadContext = vi
      .fn<CorrectionSheetProps["loadContext"]>()
      .mockImplementation(({ data }) =>
        data.productId === PRODUCT
          ? first.promise
          : Promise.resolve({ ...CONTEXT, productName: "Other Jacket" }),
      );
    const sheet = (isOpen: boolean, productId: string) => (
      <UnconfirmedRefusalAnswer gate={{ sheet: vi.fn() }}>
        <CorrectionSheet
          open={isOpen}
          onClose={vi.fn()}
          subject={{ productId, garmentId: GARMENT, category: "top" }}
          loadContext={loadContext}
          fileCorrection={vi.fn()}
        />
      </UnconfirmedRefusalAnswer>
    );
    const { rerender } = render(sheet(false, PRODUCT));
    expect(loadContext).not.toHaveBeenCalled();
    rerender(sheet(true, PRODUCT));
    expect(loadContext).toHaveBeenCalledWith({ data: { productId: PRODUCT } });
    rerender(sheet(true, OTHER));
    expect(await screen.findByText("Janji · Other Jacket")).toBeVisible();
    first.resolve(CONTEXT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Janji · AFO Middle Layer")).toBeNull();
    expect(screen.getByText("Janji · Other Jacket")).toBeVisible();
  });

  it("opens a field with none waiting empty, whatever was typed or waits elsewhere", async () => {
    const user = userEvent.setup();
    renderSheet({
      loadContext: vi
        .fn<CorrectionSheetProps["loadContext"]>()
        .mockResolvedValue({
          ...CONTEXT,
          waiting: [
            { field: "weight", value: "light", createdAt: 1_762_430_400 },
          ],
        }),
    });
    await screen.findByText("Janji · AFO Middle Layer");
    await user.click(screen.getByRole("radio", { name: "Name" }));
    const name = screen.getByRole("textbox", { name: /It should say/u });
    expect(name).toHaveValue("");
    expect(name).toHaveAttribute("type", "text");
    expect(name).toHaveAttribute("name", "value");
    await user.type(name, "AFO Jacket");
    await user.click(screen.getByRole("radio", { name: "Composition" }));
    expect(screen.getByRole("textbox", { name: /It should say/u })).toHaveValue(
      "",
    );
  });

  it("fills a field picked before the product is read, once it is, and keeps what was typed by then (#566)", async () => {
    const user = userEvent.setup();
    const read = Promise.withResolvers<CorrectionContextRow>();
    renderSheet({
      loadContext: vi
        .fn<CorrectionSheetProps["loadContext"]>()
        .mockReturnValue(read.promise),
    });
    const waiting = [
      { field: "name" as const, value: "AFO Jacket", createdAt: 1_762_430_400 },
      { field: "link" as const, value: "https://a.example", createdAt: 1 },
    ];
    await user.click(screen.getByRole("radio", { name: "Link" }));
    await user.type(
      screen.getByRole("textbox", { name: /It should say/u }),
      "https://b.example",
    );
    await user.click(screen.getByRole("radio", { name: "Name" }));
    expect(screen.getByRole("textbox", { name: /It should say/u })).toHaveValue(
      "",
    );
    read.resolve({ ...CONTEXT, waiting });
    await screen.findByText("Janji · AFO Middle Layer");
    expect(screen.getByRole("textbox", { name: /It should say/u })).toHaveValue(
      "AFO Jacket",
    );
    expect(screen.getByText(/Sending again replaces it\./u)).toBeVisible();
  });

  it("keeps what is being typed when the product is read under it, an emptied field included", async () => {
    const user = userEvent.setup();
    const read = Promise.withResolvers<CorrectionContextRow>();
    renderSheet({
      loadContext: vi
        .fn<CorrectionSheetProps["loadContext"]>()
        .mockReturnValue(read.promise),
    });
    await user.click(screen.getByRole("radio", { name: "Name" }));
    const name = screen.getByRole("textbox", { name: /It should say/u });
    await user.type(name, "My Jacket");
    read.resolve({
      ...CONTEXT,
      waiting: [{ field: "name", value: "AFO Jacket", createdAt: 1 }],
    });
    await screen.findByText("Janji · AFO Middle Layer");
    expect(screen.getByRole("textbox", { name: /It should say/u })).toHaveValue(
      "My Jacket",
    );
    await user.clear(screen.getByRole("textbox", { name: /It should say/u }));
    expect(screen.getByRole("textbox", { name: /It should say/u })).toHaveValue(
      "",
    );
  });

  it("leaves a prefilled field empty once the runner empties it", async () => {
    const user = userEvent.setup();
    renderSheet({
      loadContext: vi
        .fn<CorrectionSheetProps["loadContext"]>()
        .mockResolvedValue({
          ...CONTEXT,
          waiting: [{ field: "name", value: "AFO Jacket", createdAt: 1 }],
        }),
    });
    await screen.findByText("Janji · AFO Middle Layer");
    await user.click(screen.getByRole("radio", { name: "Name" }));
    const name = screen.getByRole("textbox", { name: /It should say/u });
    expect(name).toHaveValue("AFO Jacket");
    await user.clear(name);
    expect(name).toHaveValue("");
  });

  it("opens weight and fabric on their placeholder, and fabric on one waiting", async () => {
    const user = userEvent.setup();
    renderSheet({
      loadContext: vi
        .fn<CorrectionSheetProps["loadContext"]>()
        .mockResolvedValue({
          ...CONTEXT,
          waiting: [
            { field: "fabric", value: "down", createdAt: 1_762_430_400 },
          ],
        }),
    });
    await screen.findByText("Janji · AFO Middle Layer");
    await user.click(screen.getByRole("radio", { name: "Weight" }));
    const weight = screen.getByRole("combobox");
    expect(within(weight).getAllByRole("option")[0]).toHaveProperty(
      "selected",
      true,
    );
    await user.click(screen.getByRole("radio", { name: "Fabric" }));
    expect(screen.getByRole("combobox")).toHaveValue("down");
  });

  it("opens fabric with none waiting on its placeholder", async () => {
    const user = userEvent.setup();
    renderSheet();
    await screen.findByText("Janji · AFO Middle Layer");
    await user.click(screen.getByRole("radio", { name: "Fabric" }));
    expect(
      within(screen.getByRole("combobox")).getAllByRole("option")[0],
    ).toHaveProperty("selected", true);
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
