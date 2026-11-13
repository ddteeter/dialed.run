import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReviewQueue } from "../../src/modules/safety/components/ReviewQueue";
import type {
  HandleReview,
  QueueRow,
  ResolveOutcome,
} from "../../src/modules/safety/review";
import { bracketed } from "../ui/bracketed";
import { carriedSince } from "../ui/carry-spy";

vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
  const { spyOnCarry } = await import("../ui/carry-spy");
  return spyOnCarry(await importOriginal());
});

type Props = Parameters<typeof ReviewQueue>[0];

/**
 * A row's head strip, the button that opens it, by the name its head
 * starts with: the strip also carries the row's summary and age
 * (R55·197). The head ends at its source tag, so a name cannot match a
 * longer one by prefix.
 */
function rowNamed(head: string): RegExp {
  const escaped = head.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  return new RegExp(String.raw`^${escaped} \[`, "u");
}

function row(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    subjectType: "entry",
    subjectId: "e-1",
    source: "reports",
    createdAt: 1_755_000_000,
    reporterCount: 3,
    reasons: ["explicit"],
    subject: { photoKeys: [] },
    ...overrides,
  };
}

function renderQueue(
  queue: readonly QueueRow[],
  reviewHandle: Props["reviewHandle"] = vi
    .fn<Props["reviewHandle"]>()
    .mockResolvedValue({ outcome: "resolved" }),
) {
  const resolve: Props["resolve"] = vi
    .fn<Props["resolve"]>()
    .mockResolvedValue({ outcome: "resolved" });
  const onDecided = vi.fn<() => void>();
  render(
    <ReviewQueue
      asOf={0}
      queue={queue}
      resolve={resolve}
      reviewHandle={reviewHandle}
      onDecided={onDecided}
    />,
  );
  return { resolve, reviewHandle, onDecided };
}

/**
Every row's head, as its text reads.
*/
function heads(): (string | null)[] {
  return [...document.querySelectorAll("[data-part='row-head']")].map(
    (head) => head.textContent,
  );
}

/**
 * How many rows the waiting list holds. The list has no count of its own
 * (Review's heading carries it, round 44 #106), so this counts its rows.
 */
function waitingRows(): number {
  const heading = screen.getByRole("heading", { name: "waiting" });
  return (
    heading.parentElement?.querySelector(":scope > ul")?.children.length ?? 0
  );
}

describe("back from a kit", () => {
  it("opens and focuses the row the kit was opened from (round 52 #155.5)", () => {
    globalThis.location.hash = "#report-01HYYYYYYYYYYYYYYYYYYYYYYY";
    try {
      renderQueue([
        row(),
        row({ id: "01HYYYYYYYYYYYYYYYYYYYYYYY", subjectId: "e-2" }),
      ]);

      const second = screen.getByRole("button", {
        name: rowNamed("entry · e-2"),
      });
      expect(second).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByRole("button", { name: rowNamed("entry · e-1") }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(second.closest("li")).toHaveFocus();
      expect(second.closest("li")).toHaveAttribute("tabindex", "-1");
    } finally {
      globalThis.location.hash = "";
    }
  });

  it("opens the first row and moves nothing with no row in the hash", () => {
    renderQueue([row(), row({ id: "b", subjectId: "e-2" })]);

    expect(
      screen.getByRole("button", { name: rowNamed("entry · e-1") }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(document.body).toHaveFocus();
  });
});

describe("an empty queue", () => {
  it("says so, and says the digest agrees", () => {
    renderQueue([]);

    // The ordinary state. A reviewer seeing "nothing waiting" should also
    // know the digest is watching, or an empty page is indistinguishable
    // from a broken one.
    expect(screen.getByText(/Nothing waiting/)).toBeInTheDocument();
    expect(waitingRows()).toBe(0);
    // Arriving on an empty queue moves nothing.
    expect(document.body).toHaveFocus();
  });
});

describe("what a reviewer is shown", () => {
  it("lists what is waiting under a kicker, leaving the count to the heading (G-07)", () => {
    renderQueue([row(), row({ id: "b", subjectId: "e-2" })]);
    expect(waitingRows()).toBe(2);
    expect(screen.queryByText(bracketed("2 waiting"))).toBeNull();
  });

  it("distinguishes a classifier flag from a pile of reports", () => {
    renderQueue([
      row(),
      row({
        id: "b",
        subjectId: "p-1",
        subjectType: "photo",
        source: "classifier",
      }),
    ]);

    // A photo a model flagged is a threshold question; an entry three
    // people objected to is a judgement about people. A reviewer who
    // cannot tell them apart treats both the same way.
    expect(screen.getByText(bracketed("reports"))).toBeInTheDocument();
    expect(screen.getByText(bracketed("classifier"))).toBeInTheDocument();
  });

  it("tags a photo held on upload by what was done, not how", () => {
    renderQueue([
      row({ subjectType: "photo", subjectId: "p-2", source: "fingerprint" }),
    ]);

    // Round 41 #84: the tag names the hold, not the technique.
    expect(screen.getByText(bracketed("held on upload"))).toBeInTheDocument();
    expect(screen.queryByText(bracketed("fingerprint"))).toBeNull();
  });

  it("names what is being reviewed, in the row's head (R55·197)", () => {
    renderQueue([row({ subjectType: "product", subjectId: "p-9" })]);
    expect(heads()).toStrictEqual(["product · p-9 [reports]"]);
  });
});

describe("deciding", () => {
  it("opens with no reason chosen", () => {
    renderQueue([row()]);
    const picker = screen.getByRole("combobox");
    expect(picker).toHaveDisplayValue("Not set");
    if (!(picker instanceof HTMLSelectElement))
      throw new TypeError("no select");
    expect(picker.selectedIndex).toBe(0);
    expect(picker.value).toBe("");
  });

  it("puts the main action first, as the Desk's one chalk pill", () => {
    renderQueue([row()]);
    // Round 44 #104-#105: Remove, then Approve, then Remove as suspected
    // CSAM; the first is chalk, the rest outline pills.
    const bar = ["Remove", "Approve", "Remove as suspected CSAM"].map((name) =>
      screen.getByRole("button", { name }),
    );
    const [remove, approve, csam] = bar;
    if (remove === undefined || approve === undefined || csam === undefined) {
      throw new Error("no bar");
    }
    expect(
      remove.compareDocumentPosition(approve) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      approve.compareDocumentPosition(csam) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(remove).toHaveClass("rounded-pill", "bg-ink", "text-ground");
    expect(remove).not.toHaveClass("bg-action");
    expect(approve).toHaveClass("rounded-pill", "border-ink", "bg-transparent");
  });

  const QUEUE_ID = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

  it("approves without a reason and takes the row off the list", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(resolve).toHaveBeenCalledWith({
      data: { queueId: QUEUE_ID, action: "approve" },
    });
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("tells the page once a row is decided, so the heading's count reloads", async () => {
    const user = userEvent.setup();
    const { onDecided } = renderQueue([row()]);
    expect(onDecided).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(onDecided).toHaveBeenCalledTimes(1);
    });
  });

  it("announces the decision in the live region", async () => {
    const user = userEvent.setup();
    renderQueue([row()]);

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Decided.");
    });
  });

  it("removes with the reason the author will read", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it shows where someone lives",
    );
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(resolve).toHaveBeenCalledWith({
      data: { queueId: QUEUE_ID, action: "remove", reason: "home" },
    });
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("shows the in-flight label while a removal is pending", async () => {
    const user = userEvent.setup();
    const { promise, resolve: settle } = Promise.withResolvers<{
      outcome: ResolveOutcome;
    }>();
    const resolve: Props["resolve"] = vi
      .fn<Props["resolve"]>()
      .mockReturnValue(promise);
    render(
      <ReviewQueue
        asOf={0}
        onDecided={vi.fn()}
        queue={[row()]}
        resolve={resolve}
        reviewHandle={vi.fn()}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it shows where someone lives",
    );
    const button = screen.getByRole("button", { name: "Remove" });
    await user.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    // `PendingLabel` swaps the button's accessible name to the in-flight
    // verb while the request is outstanding. A StringLiteral mutant
    // turning "Removing" into "" would leave this empty instead.
    expect(button).toHaveAccessibleName("Removing");

    settle({ outcome: "resolved" });
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("asks again before quarantining as suspected CSAM, with Cancel focused", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row({ subjectType: "photo" })]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it's sexual or explicit",
    );
    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );

    // Round 28 #8: the second press replaces the decision bar in the row,
    // and the question says only what happens (D-88) — no account closes.
    expect(resolve).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Remove this photo everywhere and keep the evidence for the report?",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
    // Backing out is the boards' underlined text, quieter than a pill.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass(
      "border-none",
      "bg-transparent",
      "text-ink",
      "underline",
      "underline-offset-4",
    );

    await user.click(screen.getByRole("button", { name: "Remove and report" }));

    expect(resolve).toHaveBeenCalledExactlyOnceWith({
      data: { queueId: QUEUE_ID, action: "quarantine", reason: "explicit" },
    });
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("says whose account stays open, when it knows (round 29 #3)", async () => {
    const user = userEvent.setup();
    renderQueue([row({ subject: { photoKeys: [], owner: "n8" } })]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it's sexual or explicit",
    );
    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );

    expect(
      screen.getByText(
        "@n8's account stays open. Closing it is a separate action on their Runners page.",
      ),
    ).toBeInTheDocument();
  });

  it("names what the second press removes", async () => {
    const user = userEvent.setup();
    renderQueue([row()]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it's sexual or explicit",
    );
    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );

    expect(
      screen.getByText(
        "Remove this entry everywhere and keep the evidence for the report?",
      ),
    ).toBeInTheDocument();
    // No handle to name, so no line naming one.
    expect(screen.queryByText(/account stays open/)).not.toBeInTheDocument();
  });

  it("names a garment's photo as the photo, not the garment (design 157)", async () => {
    const user = userEvent.setup();
    renderQueue([
      row({ subjectType: "garment", subjectId: "g-1", source: "classifier" }),
    ]);

    // The kicker, and the second press: the garment stays in its closet.
    expect(heads()).toStrictEqual(["garment photo · g-1 [classifier]"]);
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it's sexual or explicit",
    );
    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );
    expect(
      screen.getByText(
        "Remove this garment photo everywhere and keep the evidence for the report?",
      ),
    ).toBeInTheDocument();
  });

  it("draws a garment photo's row as round 42 #88 rules: kicker with owner and source, F's card, the garment's line", () => {
    renderQueue([
      row({
        subjectType: "garment",
        subjectId: "g-1",
        source: "classifier",
        reporterCount: 0,
        reasons: [],
        subject: {
          photoKeys: ["items/u/g-1/v1/card.webp"],
          owner: "k_lopes",
          garmentLine: "Nike Pegasus 41 · Shoes · In use",
        },
      }),
    ]);

    // The head names the owner, and the source tag ends it, once.
    expect(heads()).toStrictEqual([
      "garment photo · g-1 · @k_lopes [classifier]",
    ]);
    expect(screen.getAllByText(bracketed("classifier"))).toHaveLength(1);
    const photo = screen.getByRole("img", { name: "Reported garment" });
    expect(photo).toHaveAttribute(
      "src",
      "/desk/review-photo/items/u/g-1/v1/card.webp",
    );
    expect(photo).toHaveClass("h-full", "w-full", "object-contain");
    // F's photo well: the card at its own size, not a kit photo's strip.
    expect(photo.parentElement).toHaveClass(
      "aspect-4/3",
      "w-full",
      "rounded-field",
      "border-hairline",
      "bg-photo",
      "wide:max-h-80",
    );
    const line = screen.getByText("Nike Pegasus 41 · Shoes · In use");
    expect(line).toHaveClass("font-mono", "text-mono-xs", "uppercase");
    expect(line.parentElement).toHaveClass(
      "block",
      "text-mono-xs",
      "text-quiet",
    );
    expect(photo.parentElement?.nextElementSibling).toBe(line.parentElement);
  });

  it("names nobody in a garment photo's kicker when the owner has no handle, and draws no line without one", () => {
    renderQueue([
      row({
        subjectType: "garment",
        subjectId: "g-1",
        source: "fingerprint",
        subject: { photoKeys: ["items/u/g-1/v1/card.webp"] },
      }),
    ]);

    expect(
      screen.getByRole("button", { name: rowNamed("garment photo · g-1") }),
    ).toBeVisible();
    expect(document.querySelector("[data-part='garment-line']")).toBeNull();
  });

  it("shows no photo for a garment row whose photo is gone", () => {
    renderQueue([
      row({
        subjectType: "garment",
        subjectId: "g-1",
        source: "classifier",
        subject: { photoKeys: [] },
      }),
    ]);

    expect(screen.queryByRole("img")).toBeNull();
    expect(document.querySelector("[data-part='garment-photo']")).toBeNull();
  });

  it("puts every row's source in its head, and a kit's photos as reported photos (R55·197)", () => {
    renderQueue([
      row({
        subjectType: "photo",
        subjectId: "p-1",
        source: "classifier",
        subject: { photoKeys: ["entries/u/k/1"], owner: "k_lopes" },
      }),
    ]);

    // R55·197: every head names its owner and ends with its source.
    expect(heads()).toStrictEqual(["photo · p-1 · @k_lopes [classifier]"]);
    expect(
      screen
        .getByText(bracketed("classifier"))
        .closest("[data-part='row-head']"),
    ).not.toBeNull();
    expect(screen.getByRole("img", { name: "Reported" })).toHaveClass("h-32");
    expect(document.querySelector("[data-part='garment-photo']")).toBeNull();
  });
  it("goes back to the decision bar on Cancel, deciding nothing", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it's sexual or explicit",
    );
    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(resolve).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Remove and report" }),
    ).not.toBeInTheDocument();
    // Focus goes back to the press that asked, not to the page.
    expect(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    ).toHaveFocus();
    // The reason picked before the question is still the reason.
    expect(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
    ).toHaveDisplayValue("it's sexual or explicit");
    expect(waitingRows()).toBe(1);
  });

  it("names the confirm by its in-flight verb while the quarantine is pending", async () => {
    const user = userEvent.setup();
    const { promise, resolve: settle } = Promise.withResolvers<{
      outcome: ResolveOutcome;
    }>();
    const resolve: Props["resolve"] = vi
      .fn<Props["resolve"]>()
      .mockReturnValue(promise);
    render(
      <ReviewQueue
        asOf={0}
        onDecided={vi.fn()}
        queue={[row()]}
        resolve={resolve}
        reviewHandle={vi.fn()}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it's sexual or explicit",
    );
    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );
    const confirm = screen.getByRole("button", { name: "Remove and report" });
    await user.click(confirm);

    await waitFor(() => {
      expect(confirm).toHaveAttribute("aria-busy", "true");
    });
    expect(confirm).toHaveAccessibleName("Removing");
    settle({ outcome: "resolved" });
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("keeps the question up, with the band, when the quarantine fails", async () => {
    const user = userEvent.setup();
    const resolve: Props["resolve"] = vi
      .fn<Props["resolve"]>()
      .mockRejectedValue(new Error("offline"));
    render(
      <ReviewQueue
        asOf={0}
        onDecided={vi.fn()}
        queue={[row()]}
        resolve={resolve}
        reviewHandle={vi.fn()}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it's sexual or explicit",
    );
    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove and report" }));

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove and report" }),
    ).toBeInTheDocument();
    expect(waitingRows()).toBe(1);
  });

  it("refuses a Remove with no reason, and says why", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );

    expect(resolve).not.toHaveBeenCalled();
    const said = await screen.findAllByText("Pick why it's coming down.");
    expect(said.length).toBeGreaterThan(0);
    expect(waitingRows()).toBe(1);
    // No question is asked whose answer would only be refused.
    expect(
      screen.queryByRole("button", { name: "Remove and report" }),
    ).not.toBeInTheDocument();
  });

  it("refuses suspected CSAM with no reason, on the field, without asking", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);

    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );

    expect(resolve).not.toHaveBeenCalled();
    const said = await screen.findAllByText("Pick why it's coming down.");
    expect(said.length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Remove and report" }),
    ).not.toBeInTheDocument();
  });

  it("treats a reason picked and then taken back as nothing chosen", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);
    const picker = screen.getByRole("combobox");

    await user.selectOptions(picker, "it's an ad or spam");
    expect(picker).toHaveDisplayValue("it's an ad or spam");
    await user.selectOptions(picker, "Not set");
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));

    expect(resolve).not.toHaveBeenCalled();
    const said = await screen.findAllByText("Pick why it's coming down.");
    expect(said.length).toBeGreaterThan(0);
    expect(picker).toHaveDisplayValue("Not set");
  });

  it("keeps a row whose decision failed, so it can be tried again", async () => {
    const user = userEvent.setup();
    const resolve: Props["resolve"] = vi
      .fn<Props["resolve"]>()
      .mockRejectedValue(new Error("offline"));
    render(
      <ReviewQueue
        asOf={0}
        onDecided={vi.fn()}
        queue={[row()]}
        resolve={resolve}
        reviewHandle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledTimes(1);
    });
    expect(waitingRows()).toBe(1);
  });

  it("only takes the decided row off the list", async () => {
    const user = userEvent.setup();
    renderQueue([row(), row({ id: "b", subjectId: "e-2" })]);

    const [first] = screen.getAllByRole("button", { name: "Approve" });
    if (!first) throw new Error("no approve buttons rendered");
    await user.click(first);

    await waitFor(() => {
      expect(waitingRows()).toBe(1);
    });
    expect(heads()).toStrictEqual(["entry · e-2 [reports]"]);
  });

  it("decides one row at a time, the oldest first unless another is picked", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([
      row(),
      row({ id: "01HYYYYYYYYYYYYYYYYYYYYYYY", subjectId: "e-2" }),
    ]);

    // Round 28 #8: the row itself opens; there is no "Decide this one".
    expect(
      screen.queryByRole("button", { name: "Decide this one" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    const first = screen.getByRole("button", { name: rowNamed("entry · e-1") });
    const second = screen.getByRole("button", {
      name: rowNamed("entry · e-2"),
    });
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");

    await user.click(second);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(resolve).toHaveBeenCalledWith({
      data: { queueId: "01HYYYYYYYYYYYYYYYYYYYYYYY", action: "approve" },
    });
    await waitFor(() => {
      expect(waitingRows()).toBe(1);
    });
    // The one left is decided next, with no pick needed.
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("moves focus to the next row once a decision lands, never on arrival", async () => {
    const user = userEvent.setup();
    renderQueue([
      row(),
      row({ id: "01HYYYYYYYYYYYYYYYYYYYYYYY", subjectId: "e-2" }),
    ]);
    const next = screen.getByRole("button", { name: rowNamed("entry · e-2") });

    // Arriving on the page moves nothing.
    expect(document.body).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(next).toHaveFocus();
    });
    expect(next).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps handing focus on, row after row", async () => {
    const user = userEvent.setup();
    renderQueue([
      row(),
      row({ id: "01HYYYYYYYYYYYYYYYYYYYYYYY", subjectId: "e-2" }),
      row({ id: "01HXXXXXXXXXXXXXXXXXXXXXXX", subjectId: "e-3" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: rowNamed("entry · e-2") }),
      ).toHaveFocus();
    });
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: rowNamed("entry · e-3") }),
      ).toHaveFocus();
    });
    expect(waitingRows()).toBe(1);
  });

  it("does not take focus back from the decision once the row has it", async () => {
    const user = userEvent.setup();
    renderQueue([
      row(),
      row({ id: "01HYYYYYYYYYYYYYYYYYYYYYYY", subjectId: "e-2" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const next = screen.getByRole("button", { name: rowNamed("entry · e-2") });
    await waitFor(() => {
      expect(next).toHaveFocus();
    });

    // Picking a reason re-renders the row; focus stays on the picker.
    const picker = screen.getByRole("combobox", { name: /Why it comes down/ });
    await user.selectOptions(picker, "it's an ad or spam");

    expect(picker).toHaveFocus();
  });

  it("opens the row that takes the decided one's place, not the oldest", async () => {
    const user = userEvent.setup();
    renderQueue([
      row(),
      row({ id: "01HYYYYYYYYYYYYYYYYYYYYYYY", subjectId: "e-2" }),
      row({ id: "01HXXXXXXXXXXXXXXXXXXXXXXX", subjectId: "e-3" }),
    ]);
    await user.click(
      screen.getByRole("button", { name: rowNamed("entry · e-2") }),
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));

    // A reviewer working down from the middle keeps their place.
    const third = screen.getByRole("button", { name: rowNamed("entry · e-3") });
    await waitFor(() => {
      expect(third).toHaveFocus();
    });
    expect(third).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: rowNamed("entry · e-1") }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the row before when the last one was decided", async () => {
    const user = userEvent.setup();
    renderQueue([
      row(),
      row({ id: "01HYYYYYYYYYYYYYYYYYYYYYYY", subjectId: "e-2" }),
      row({ id: "01HXXXXXXXXXXXXXXXXXXXXXXX", subjectId: "e-3" }),
    ]);
    await user.click(
      screen.getByRole("button", { name: rowNamed("entry · e-3") }),
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));

    const second = screen.getByRole("button", {
      name: rowNamed("entry · e-2"),
    });
    await waitFor(() => {
      expect(second).toHaveFocus();
    });
    expect(second).toHaveAttribute("aria-expanded", "true");
  });

  it("lands focus on the empty line once the last row is decided", async () => {
    const user = userEvent.setup();
    renderQueue([row()]);

    await user.click(screen.getByRole("button", { name: "Approve" }));

    // The row, and focus with it, are gone: the line that says what is
    // now true takes it, rather than the page.
    const line = await screen.findByText(/Nothing waiting/);
    await waitFor(() => {
      expect(line).toHaveFocus();
    });
    // Focusable by script only: a sentence, not a stop in the tab order.
    expect(line).toHaveAttribute("tabindex", "-1");
  });

  it("returns focus on Cancel even when the press that asked never held it", async () => {
    const user = userEvent.setup();
    renderQueue([row()]);
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
      "it's sexual or explicit",
    );

    // A press that moves no focus (a pointer on some devices, a switch),
    // so nothing but Cancel's own return can put focus back.
    fireEvent.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    ).toHaveFocus();
  });

  it("does not ask the same row twice", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });

    // The row is gone, so there is no second button to press. The server
    // refuses a second decision anyway, but a UI that kept offering one
    // would be inviting a reviewer to undo their own call by accident.
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("what a row tells the reviewer", () => {
  it("says what was alleged, in the reporters' own words", () => {
    renderQueue([
      row({ reporterCount: 3, reasons: ["explicit", "harassment"] }),
    ]);

    // The row's whole content. Without it a reviewer is deciding about a
    // subject type and a ULID, and Approve on an opaque id is not a
    // judgement about anything.
    expect(screen.getByText(bracketed("3 people"))).toBeInTheDocument();
    // The whole line, separator included. Two reasons run together read
    // as one sentence nobody wrote.
    expect(
      screen.getByText(
        "Harassment aimed at someone · The photo shows someone inappropriately",
      ),
    ).toBeInTheDocument();
  });

  it("counts one person as a person", () => {
    renderQueue([row({ reporterCount: 1 })]);
    expect(screen.getByText(bracketed("1 person"))).toBeInTheDocument();
  });

  it("shows the removal clock at the head's right, in bold hi-viz, on a row an intimate-image report started (round 35 #58b, R55·197)", () => {
    renderQueue([
      row({
        reporterCount: 1,
        reasons: ["intimate"],
        due: "Due in 31h",
        dueAt: 100,
      }),
    ]);
    const opener = screen.getByRole("button", { expanded: true });
    const clock = within(opener).getByText("Due in 31h");
    expect(clock).toHaveClass(
      "font-mono",
      "uppercase",
      "font-semibold",
      "text-hiviz-text",
    );
    expect(clock).not.toHaveClass("bg-hi-viz");
    // Beside the head, keeping its width; the head is one line, whole in
    // its title (N3-10).
    expect(clock.parentElement).toHaveClass("shrink-0", "whitespace-nowrap");
    const head = opener.querySelector("[data-part='row-head']");
    expect(head).toHaveClass("truncate");
    expect(head).toHaveAttribute("title", "e-1");
    // The brackets stay about people.
    expect(screen.getByText(bracketed("1 person"))).toBeInTheDocument();
    expect(screen.queryByText(bracketed("Due in 31h"))).toBeNull();
    expect(
      screen.getByText(
        "It's an intimate image of someone, shared without their consent",
      ),
    ).toBeInTheDocument();
  });

  it("shortens an id that stands in for a label to its first and last four, whole in the title (R55·197)", () => {
    renderQueue([
      row({ subjectType: "photo", subjectId: "01M7738DQS3ABCDEFGHJKBGCG" }),
    ]);
    expect(heads()).toStrictEqual(["photo · 01M7…BGCG [reports]"]);
    expect(document.querySelector("[data-part='row-head']")).toHaveAttribute(
      "title",
      "01M7738DQS3ABCDEFGHJKBGCG",
    );
  });

  it("sums a closed row up by why it is here (R55·197)", () => {
    renderQueue([
      row({ id: "a" }),
      row({
        id: "b",
        source: "classifier",
        reporterCount: 0,
        reasons: [],
      }),
      row({ id: "c", source: "unscreened", reporterCount: 0, reasons: [] }),
      row({
        id: "d",
        subjectType: "profile",
        reporterCount: 0,
        reasons: [],
        subject: { photoKeys: [], handleFlagged: true },
      }),
      row({ id: "e", reporterCount: 1, reasons: ["explicit"] }),
    ]);
    const summaries = [
      ...document.querySelectorAll("[data-part='row-summary']"),
    ].map((summary) => summary.textContent);
    expect(summaries).toStrictEqual([
      "Nobody reported this.",
      "Uploaded over a day ago and still not screened: the classifier has not answered for it. Nobody but its owner sees it while it waits.",
      "The hourly re-check flagged a handle this runner already has. Nothing is hidden while it waits.",
      "1 person · The photo shows someone inappropriately",
    ]);
  });

  it("names a row's strip by everything it shows: head, summary, age (R55·197; WCAG 2.5.3)", () => {
    renderQueue([row(), row({ id: "b", subjectId: "e-2" })]);
    const closed = screen.getByRole("button", { expanded: false });
    expect(closed).toHaveAccessibleName(
      "entry · e-2 [reports] 3 people · The photo shows someone inappropriately 0m",
    );
  });

  it("draws OVERDUE as a filled hi-viz tag once the 48 hours run out (R55·197)", () => {
    renderQueue([
      row({
        reporterCount: 1,
        reasons: ["intimate"],
        due: "Overdue",
        dueAt: 0,
      }),
    ]);
    const tag = within(
      screen.getByRole("button", { expanded: true }),
    ).getByText("Overdue");
    expect(tag).toHaveClass("bg-hi-viz", "text-accent-ink", "font-semibold");
  });

  it("dates a row with no clock by how long it has waited (R55·197)", () => {
    render(
      <ReviewQueue
        asOf={1_755_000_000 + 4 * 3600 + 60}
        queue={[row({ source: "classifier", reporterCount: 0, reasons: [] })]}
        resolve={vi.fn<Props["resolve"]>()}
        reviewHandle={vi.fn<Props["reviewHandle"]>()}
        onDecided={vi.fn<() => void>()}
      />,
    );
    const age = within(
      screen.getByRole("button", { expanded: true }),
    ).getByText("4h");
    expect(age).toHaveClass("text-muted");
  });

  it("draws a row as a --panel card, its open body and bar under hairlines (R55·197)", () => {
    renderQueue([row(), row({ id: "b", subjectId: "e-2" })]);
    const [open, closed] = screen.getAllByRole("listitem");
    expect(open).toHaveClass("rounded-card", "border", "bg-panel");
    expect(open?.querySelector("[data-part='row-body']")).toHaveClass(
      "border-t",
      "border-hairline",
      "p-4",
    );
    expect(open?.querySelector("[data-part='row-bar']")).toHaveClass(
      "border-t",
      "border-hairline",
    );
    // The waiting list's rows stand 12 apart.
    expect(open?.parentElement).toHaveClass("gap-3");
    // A closed row is its head, a one-line summary and the fold's mark.
    expect(closed?.querySelector("[data-part='row-body']")).toBeNull();
    const summary = closed?.querySelector("[data-part='row-summary']");
    expect(summary).toHaveTextContent(
      "3 people · The photo shows someone inappropriately",
    );
    expect(summary).toHaveClass("truncate");
    expect(open?.querySelector("[data-part='row-summary']")).toBeNull();
  });
  it("says what intimate means on a row an intimate-image report started (D-161)", () => {
    renderQueue([
      row({ reporterCount: 1, reasons: ["intimate"], due: "Due in 31h" }),
    ]);
    const line = document.querySelector('[data-part="statutory-line"]');
    expect(line).toHaveTextContent(
      "Intimate means nudity or sexual content (15 U.S.C. § 6851). If it isn't, decline, and remove it under another rule if it breaks one.",
    );
    // R47·126: MONO.xs, --muted, sentence case, on its own line.
    expect(line).toHaveClass("font-mono", "text-mono-xs", "text-muted");
    expect(line).not.toHaveClass("uppercase");
  });

  it("puts the statutory line directly under the reason, above the fold (R47·126)", () => {
    render(
      <ReviewQueue
        asOf={0}
        onDecided={vi.fn()}
        queue={[
          row({ reporterCount: 1, reasons: ["intimate"], due: "Due in 31h" }),
        ]}
        resolve={vi.fn<Props["resolve"]>()}
        reviewHandle={vi.fn<Props["reviewHandle"]>()}
        reporters={vi.fn()}
      />,
    );
    const line = document.querySelector('[data-part="statutory-line"]');
    const reason = screen.getByText(
      "It's an intimate image of someone, shared without their consent",
    );
    expect(line?.previousElementSibling).toContainElement(reason);
    expect(line?.nextElementSibling).toHaveTextContent(/^Who reported/iu);
  });

  it("shows no clock on any other row", () => {
    renderQueue([row({ reporterCount: 3 })]);
    expect(screen.queryByText(/Due in|Overdue/u)).toBeNull();
    expect(document.querySelector('[data-part="due"]')).toBeNull();
    expect(document.querySelector('[data-part="statutory-line"]')).toBeNull();
  });

  it("says nobody reported a row the classifier raised", () => {
    renderQueue([row({ source: "classifier", reporterCount: 0, reasons: [] })]);

    // A classifier row has no people behind it. Rendering an empty reason
    // list would read as a report with nothing written on it.
    expect(screen.getByText("Nobody reported this.")).toBeInTheDocument();
    // The same step as a stuck photo's sentence, its neighbour (N3-13).
    expect(screen.getByText("Nobody reported this.").parentElement).toHaveClass(
      "text-small",
    );
    expect(screen.getByText(bracketed("classifier"))).toBeInTheDocument();
    // Nor "[0 people]" over it: nobody is not a count of people.
    expect(screen.queryByText(bracketed("0 people"))).toBeNull();
  });

  it("reads the same set the same way whatever order it arrives in", () => {
    renderQueue([row({ reasons: ["spam", "explicit"] })]);
    const first = screen.getByText(/It's an ad/).textContent;
    renderQueue([row({ reasons: ["explicit", "spam"] })]);

    // A queue is scanned, not read, and two rows carrying the same set
    // should look identical.
    expect(screen.getAllByText(/It's an ad/)[1]?.textContent).toBe(first);
  });
});

describe("the subject itself", () => {
  it("shows the reported photo, from the route that will serve it", () => {
    renderQueue([
      row({
        subjectType: "photo",
        subject: { photoKeys: ["entries/u-1/e-1/p-1"] },
      }),
    ]);

    // `/desk/review-photo/`, not `/feed/photo/`. Every photo in this
    // queue is hidden precisely because somebody reported it, so the
    // ordinary route refuses it — pointing at that one would give a
    // reviewer a broken image on the subject that most needs looking at.
    const photo = screen.getByRole("img", { name: "Reported" });
    expect(photo).toHaveAttribute(
      "src",
      "/desk/review-photo/entries/u-1/e-1/p-1",
    );
  });

  it("shows every photo of a reported entry", () => {
    renderQueue([
      row({
        subjectType: "entry",
        subject: { photoKeys: ["entries/u/e/a", "entries/u/e/b"] },
      }),
    ]);

    // A kit posted as two photos is one thing to judge, and judging half
    // of it is judging something else.
    expect(screen.getAllByRole("img", { name: "Reported" })).toHaveLength(2);
  });

  it("names a runner or a product instead of its id", () => {
    renderQueue([
      row({
        subjectType: "product",
        subjectId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        subject: { label: "Some Shoe", photoKeys: [] },
      }),
    ]);

    // Words are the whole content of these rows the way pixels are of a
    // photo. "product · 01HZZZ…" tells a reviewer nothing they can weigh.
    expect(screen.getByText(/Some Shoe/)).toBeInTheDocument();
    expect(screen.queryByText(/01HZZZ/)).not.toBeInTheDocument();
  });

  it("falls back to the id when there is nothing to name", () => {
    renderQueue([row({ subjectId: "e-404", subject: { photoKeys: [] } })]);

    // A subject whose row has been deleted since the report. The id is
    // not useful, but it is honest — and it is what a reviewer would
    // quote when asking what happened.
    expect(screen.getByText(/e-404/)).toBeInTheDocument();
  });

  it("draws no frame at all when there is no photo", () => {
    renderQueue([row({ subject: { label: "mark_t", photoKeys: [] } })]);

    // An empty frame on a profile row reads as an image that failed to
    // load, which is a different problem from the one being reviewed.
    expect(
      screen.queryByRole("img", { name: "Reported" }),
    ).not.toBeInTheDocument();

    // And no empty container either. The row is a flex column with a gap,
    // so an element with nothing in it is not nothing — it is a blank
    // band between the subject and the reasons, on every row that is a
    // runner or a product rather than a photo.
    const empties = [
      ...screen.getByRole("listitem").querySelectorAll("span"),
    ].filter((node) => node.childElementCount === 0 && node.textContent === "");
    expect(empties).toEqual([]);
  });
});

/**
A review row about a photo still pending a day after upload.
*/
function stuck(source: "unscreened" | "missing_file"): QueueRow {
  return row({
    subjectType: "photo",
    subjectId: "p-7",
    source,
    reporterCount: 0,
    reasons: [],
    subject: { photoKeys: ["entries/u-1/e-1/p-7"], owner: "n8" },
  });
}

const CLEAR_REFUSED =
  "Nothing changed. This photo was already handled or uploaded again. Reload to see it.";

function renderStuck(resolve: Props["resolve"]): void {
  render(
    <ReviewQueue
      asOf={0}
      onDecided={vi.fn()}
      queue={[stuck("missing_file")]}
      resolve={resolve}
      reviewHandle={vi.fn()}
    />,
  );
}

describe("a photo still pending a day after upload (D-157)", () => {
  it("says the classifier never answered, and shows the photo", () => {
    renderQueue([stuck("unscreened")]);

    expect(
      screen.getByText(bracketed("not screened in a day")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Uploaded over a day ago and still not screened: the classifier has not answered for it. Nobody but its owner sees it while it waits.",
      ),
    ).toHaveClass("text-small", "text-quiet");
    // Not a reported row: no count of people, no "Nobody reported this".
    expect(screen.queryByText(/Nobody reported this/)).toBeNull();
    expect(screen.queryByText(bracketed("0 people"))).toBeNull();
    expect(screen.getByRole("img", { name: "Reported" })).toHaveAttribute(
      "src",
      "/desk/review-photo/entries/u-1/e-1/p-7",
    );
  });

  it("says the file is missing, and draws no frame for it", () => {
    renderQueue([stuck("missing_file")]);

    expect(screen.getByText(bracketed("file missing"))).toBeInTheDocument();
    expect(
      screen.getByText(
        "Uploaded over a day ago, and its file is not in storage, so it cannot be screened or shown. Nobody but its owner sees it while it waits.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Reported" }),
    ).not.toBeInTheDocument();
  });

  it("is decided as any other photo row: the full bar (round 45 #100)", () => {
    renderQueue([stuck("unscreened")]);
    for (const name of ["Remove", "Approve", "Remove as suspected CSAM"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("combobox", { name: /Why it comes down/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear photo" }),
    ).not.toBeInTheDocument();
  });

  it("offers only Clear photo for a missing file, as the chalk pill, and sends no reason (round 45 #100)", async () => {
    const user = userEvent.setup();
    const { promise, resolve: settle } = Promise.withResolvers<{
      outcome: ResolveOutcome;
    }>();
    const { resolve } = renderQueue([stuck("missing_file")]);
    vi.mocked(resolve).mockReturnValue(promise);

    // Nothing to judge and no evidence to keep: no Approve, no Remove, no
    // CSAM, and no reason to pick.
    for (const name of ["Approve", "Remove", "Remove as suspected CSAM"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const clear = screen.getByRole("button", { name: "Clear photo" });
    expect(clear).toHaveClass("bg-ink", "text-ground", "rounded-pill");
    await user.click(clear);
    await waitFor(() => {
      expect(clear).toHaveAccessibleName("Clearing");
    });
    settle({ outcome: "resolved" });

    expect(resolve).toHaveBeenCalledWith({
      data: { queueId: "01HZZZZZZZZZZZZZZZZZZZZZZZ", action: "clear" },
    });
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("keeps a row whose Clear photo was refused, with its own line and no Try again", async () => {
    const user = userEvent.setup();
    renderStuck(
      vi.fn<Props["resolve"]>().mockResolvedValue({ outcome: "not_found" }),
    );

    await user.click(screen.getByRole("button", { name: "Clear photo" }));

    // The server declined: the photo was screened or re-uploaded since,
    // and the row is still open. Nothing failed, so no band: the owner's
    // line, said in the status region, and a reload rather than a retry.
    expect(
      await screen.findByText(CLEAR_REFUSED, { selector: "p" }),
    ).toHaveAttribute("data-part", "decision-refused");
    expect(screen.getByRole("status")).toHaveTextContent(CLEAR_REFUSED);
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Our end failed/)).not.toBeInTheDocument();
    expect(waitingRows()).toBe(1);
  });

  it("drops the refused line at the next press", async () => {
    const user = userEvent.setup();
    // The second press is left unanswered, so the row stays and only the
    // line's going is observed.
    renderStuck(
      vi
        .fn<Props["resolve"]>()
        .mockResolvedValueOnce({ outcome: "not_found" })
        .mockReturnValueOnce(Promise.withResolvers<never>().promise),
    );

    await user.click(screen.getByRole("button", { name: "Clear photo" }));
    await screen.findByText(CLEAR_REFUSED, { selector: "p" });
    await user.click(screen.getByRole("button", { name: "Clear photo" }));

    // No line at all, not an empty one.
    expect(document.querySelector("[data-part='decision-refused']")).toBeNull();
    expect(waitingRows()).toBe(1);
  });

  it("keeps a row whose Clear photo failed, with the failure band", async () => {
    const user = userEvent.setup();
    renderStuck(
      vi.fn<Props["resolve"]>().mockRejectedValue(new Error("D1 down")),
    );

    await user.click(screen.getByRole("button", { name: "Clear photo" }));

    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nothing saved. Our end failed. Nothing changed."),
    ).toBeInTheDocument();
    // No line at all, not an empty one.
    expect(document.querySelector("[data-part='decision-refused']")).toBeNull();
    expect(waitingRows()).toBe(1);
  });

  it("takes a row off when Clear photo finds it already decided", async () => {
    const user = userEvent.setup();
    const resolve: Props["resolve"] = vi
      .fn<Props["resolve"]>()
      .mockResolvedValue({ outcome: "already_resolved" });
    render(
      <ReviewQueue
        asOf={0}
        onDecided={vi.fn()}
        queue={[stuck("missing_file")]}
        resolve={resolve}
        reviewHandle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear photo" }));

    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("takes a row off when Approve finds nothing, as before", async () => {
    const user = userEvent.setup();
    const resolve: Props["resolve"] = vi
      .fn<Props["resolve"]>()
      .mockResolvedValue({ outcome: "not_found" });
    render(
      <ReviewQueue
        asOf={0}
        onDecided={vi.fn()}
        queue={[stuck("unscreened")]}
        resolve={resolve}
        reviewHandle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });
});

/**
A review row about a runner whose handle the re-ask flagged.
*/
function flagged(overrides: Partial<QueueRow> = {}): QueueRow {
  return row({
    subjectType: "profile",
    subjectId: "u-1",
    source: "classifier",
    reporterCount: 0,
    reasons: [],
    subject: { label: "quadzilla_69", photoKeys: [], handleFlagged: true },
    ...overrides,
  });
}

describe("a handle the re-ask flagged (D-97)", () => {
  const QUEUE_ID = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

  it("offers Keep and Rename with D8's reasons, and never Remove", () => {
    renderQueue([flagged()]);

    // Nothing said yet: the band is for a taken placeholder.
    expect(document.querySelector("[data-part='control-failure']")).toBeNull();

    // Round 35 #45: it names why it is there — the re-check's kicker where
    // a content row names its kind, and the re-check's line where a
    // content row lists what the reporters said.
    expect(
      screen.getByRole("button", {
        name: rowNamed("handle · re-check · quadzilla_69"),
      }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-part='why-here']")).toHaveTextContent(
      /^The hourly re-check flagged a handle this runner already has\. Nothing is hidden while it waits\.$/u,
    );
    expect(screen.queryByText("Nobody reported this.")).toBeNull();
    expect(screen.getByText(bracketed("classifier"))).toBeInTheDocument();
    // A decision that is not the row's submit is the boards' outline pill,
    // not bare text (R-173: on the Desk's dark ground it read as a label).
    expect(screen.getByRole("button", { name: "Keep" })).toHaveClass(
      "rounded-pill",
      "border",
      "border-ink",
      "bg-transparent",
      "font-bold",
      "text-ink",
    );
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove as suspected CSAM" }),
    ).toBeNull();
    const picker = screen.getByRole("combobox", {
      name: /Why the name has to go/,
    });
    expect(
      [...picker.querySelectorAll("option")].map(
        (option) => option.textContent,
      ),
    ).toStrictEqual([
      "Not set",
      "Offensive or sexual",
      "Pretends to be someone else",
      "Contains personal information",
      "Advertising",
    ]);
  });

  it("keeps the handle with no reason, and takes the row off the list", async () => {
    const user = userEvent.setup();
    const { reviewHandle } = renderQueue([flagged()]);

    await user.click(screen.getByRole("button", { name: "Keep" }));

    expect(reviewHandle).toHaveBeenCalledWith({
      data: { queueId: QUEUE_ID, action: "keep" },
    });
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("announces the decision in the live region", async () => {
    const user = userEvent.setup();
    renderQueue([flagged()]);

    await user.click(screen.getByRole("button", { name: "Keep" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Decided.");
    });
  });

  it("renames with the reason the runner will read", async () => {
    const user = userEvent.setup();
    const { reviewHandle } = renderQueue([flagged()]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
      "Offensive or sexual",
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(reviewHandle).toHaveBeenCalledWith({
      data: {
        queueId: QUEUE_ID,
        action: "rename",
        nameReason: "Offensive or sexual",
      },
    });
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("shows the in-flight label while a rename is pending", async () => {
    const user = userEvent.setup();
    const { promise, resolve: settle } = Promise.withResolvers<HandleReview>();
    const reviewHandle: Props["reviewHandle"] = vi
      .fn<Props["reviewHandle"]>()
      .mockReturnValue(promise);
    render(
      <ReviewQueue
        asOf={0}
        onDecided={vi.fn()}
        queue={[flagged()]}
        resolve={vi.fn()}
        reviewHandle={reviewHandle}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
      "Offensive or sexual",
    );
    const button = screen.getByRole("button", { name: "Rename" });
    await user.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    // Same `PendingLabel` swap as the content row's Remove, for the
    // flagged-handle row's own submit — the "Renaming" StringLiteral
    // mutant survives unless something reads this name while pending.
    expect(button).toHaveAccessibleName("Renaming");

    settle({ outcome: "resolved" });
    await waitFor(() => {
      expect(waitingRows()).toBe(0);
    });
  });

  it("refuses a Rename with no reason, and says why", async () => {
    const user = userEvent.setup();
    const { reviewHandle } = renderQueue([flagged()]);

    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(reviewHandle).not.toHaveBeenCalled();
    const said = await screen.findAllByText("Pick why the name has to go.");
    expect(said.length).toBeGreaterThan(0);
  });

  it("keeps the row when the drawn placeholder is taken, with D8's sentence", async () => {
    const user = userEvent.setup();
    renderQueue(
      [flagged()],
      vi.fn<Props["reviewHandle"]>().mockResolvedValue({ outcome: "taken" }),
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
      "Advertising",
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(
      await screen.findByText("That placeholder is taken. Press Rename again."),
    ).toBeInTheDocument();
    // In the row's control band, under NOT RENAMED, with no Try again:
    // the sentence says to press Rename (round 35 #45).
    const band = document.querySelector("[data-part='control-failure']");
    expect(band).toHaveTextContent(
      /^Not renamed.*That placeholder is taken\. Press Rename again\.$/u,
    );
    expect(band?.querySelector("button")).toBeNull();
    expect(waitingRows()).toBe(1);
  });

  it("keeps the row when the handle changed before the rename landed, and re-reads its header (R-121; round 38 #60)", async () => {
    const user = userEvent.setup();
    renderQueue(
      [flagged()],
      vi
        .fn<Props["reviewHandle"]>()
        .mockResolvedValue({ outcome: "moved", username: "dunk_runs" }),
    );
    expect(
      screen.getByRole("button", {
        name: rowNamed("handle · re-check · quadzilla_69"),
      }),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
      "Advertising",
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));

    const band = await screen.findByText(
      "The handle changed to @dunk_runs before the rename landed. Nothing was renamed. Look at it, then press Rename again if it still has to go.",
    );
    expect(band.closest("[data-part='control-failure']")).toHaveTextContent(
      /^Not renamed/u,
    );
    expect(waitingRows()).toBe(1);
    expect(
      screen.getByRole("button", {
        name: rowNamed("handle · re-check · dunk_runs"),
      }),
    ).toBeInTheDocument();
    // Still open, with its decision, for Keep or another Rename.
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });

  it("names a row with no label by its subject id", () => {
    renderQueue([
      flagged({
        subject: { label: undefined, photoKeys: [], handleFlagged: true },
      }),
    ]);

    expect(
      screen.getByRole("button", { name: rowNamed("handle · re-check · u-1") }),
    ).toBeInTheDocument();
  });

  it("decides a reported profile, whose handle nobody flagged, as any other row", () => {
    renderQueue([
      flagged({
        source: "reports",
        subject: { label: "dee", photoKeys: [], handleFlagged: false },
      }),
    ]);

    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    // Its kind is its own, and the reporters speak for it.
    expect(
      screen.getByRole("button", { name: rowNamed("profile · dee") }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-part='why-here']")).toBeNull();
  });
});

describe("the review queue: a lapsed session (Au7, D-155)", () => {
  it.each([
    ["a content row's removal", row],
    ["a flagged handle's review", flagged],
  ])("carries %s as the page", (_case, queued) => {
    carriedSince();
    renderQueue([queued()]);

    expect(carriedSince()).toEqual(["page"]);
  });
});

function renderWithFold(queue: readonly QueueRow[]) {
  const reporters = vi
    .fn<NonNullable<Props["reporters"]>>()
    .mockResolvedValue([]);
  render(
    <ReviewQueue
      asOf={0}
      onDecided={vi.fn()}
      queue={queue}
      resolve={vi
        .fn<Props["resolve"]>()
        .mockResolvedValue({ outcome: "resolved" })}
      reviewHandle={vi
        .fn<Props["reviewHandle"]>()
        .mockResolvedValue({ outcome: "resolved" })}
      reporters={reporters}
    />,
  );
  return reporters;
}

describe("the WHO REPORTED fold on a row (D-164)", () => {
  it("sits on a reported row, after the reasons and before the decision", () => {
    renderWithFold([row({ reporterCount: 4 })]);
    const fold = screen.getByRole("button", { name: /Who reported/u });
    // Its label counts the row's reporters (R50·145, #497).
    expect(fold).toHaveTextContent("Who reported · 4 ▸");
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(
      fold.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens by the row's own id", async () => {
    const user = userEvent.setup();
    const reporters = renderWithFold([row()]);
    await user.click(screen.getByRole("button", { name: /Who reported/u }));
    expect(reporters).toHaveBeenCalledWith({
      data: { queueId: "01HZZZZZZZZZZZZZZZZZZZZZZZ" },
    });
  });

  it("is not on a row nobody reported", () => {
    renderWithFold([
      row({ source: "classifier", reporterCount: 0, reasons: [] }),
    ]);
    expect(screen.queryByRole("button", { name: /Who reported/u })).toBeNull();
  });

  it("is not there without the read to open it", () => {
    renderQueue([row()]);
    expect(screen.queryByRole("button", { name: /Who reported/u })).toBeNull();
  });
});
