import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReviewQueue } from "../../src/modules/safety/components/ReviewQueue";
import type { QueueRow } from "../../src/modules/safety/review";

type Props = Parameters<typeof ReviewQueue>[0];

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

function renderQueue(queue: readonly QueueRow[]) {
  const resolve: Props["resolve"] = vi
    .fn<Props["resolve"]>()
    .mockResolvedValue({ outcome: "resolved" });
  render(<ReviewQueue queue={queue} resolve={resolve} />);
  return { resolve };
}

describe("an empty queue", () => {
  it("says so, and says the digest agrees", () => {
    renderQueue([]);

    // The ordinary state. A reviewer seeing "nothing waiting" should also
    // know the digest is watching, or an empty page is indistinguishable
    // from a broken one.
    expect(screen.getByText(/Nothing waiting/)).toBeInTheDocument();
    expect(screen.getByText("[0 waiting]")).toBeInTheDocument();
  });
});

describe("what a reviewer is shown", () => {
  it("counts what is waiting", () => {
    renderQueue([row(), row({ id: "b", subjectId: "e-2" })]);
    expect(screen.getByText("[2 waiting]")).toBeInTheDocument();
  });

  it("distinguishes a classifier flag from a pile of reports", () => {
    renderQueue([
      row(),
      row({ id: "b", subjectId: "p-1", subjectType: "photo", source: "classifier" }),
    ]);

    // A photo a model flagged is a threshold question; an entry three
    // people objected to is a judgement about people. A reviewer who
    // cannot tell them apart treats both the same way.
    expect(screen.getByText("[reports]")).toBeInTheDocument();
    expect(screen.getByText("[classifier]")).toBeInTheDocument();
  });

  it("names what is being reviewed", () => {
    renderQueue([row({ subjectType: "product", subjectId: "p-9" })]);
    expect(screen.getByText(/product · p-9/)).toBeInTheDocument();
  });
});

describe("deciding", () => {
  it("approves and takes the row off the list", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(resolve).toHaveBeenCalledWith({
      data: { queueId: "01HZZZZZZZZZZZZZZZZZZZZZZZ", decision: "approve" },
    });
    await waitFor(() => {
      expect(screen.getByText("[0 waiting]")).toBeInTheDocument();
    });
  });

  it("removes with the other button", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    // Two buttons, two decisions. A single "resolve" with a hidden default
    // would make the more destructive one the easier one to hit.
    expect(resolve).toHaveBeenCalledWith({
      data: { queueId: "01HZZZZZZZZZZZZZZZZZZZZZZZ", decision: "remove" },
    });
  });

  it("only takes the decided row off the list", async () => {
    const user = userEvent.setup();
    renderQueue([row(), row({ id: "b", subjectId: "e-2" })]);

    const [first] = screen.getAllByRole("button", { name: "Approve" });
    if (!first) throw new Error("no approve buttons rendered");
    await user.click(first);

    await waitFor(() => {
      expect(screen.getByText("[1 waiting]")).toBeInTheDocument();
    });
    expect(screen.getByText(/entry · e-2/)).toBeInTheDocument();
  });

  it("does not ask the same row twice", async () => {
    const user = userEvent.setup();
    const { resolve } = renderQueue([row()]);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(screen.getByText("[0 waiting]")).toBeInTheDocument();
    });

    // The row is gone, so there is no second button to press. The server
    // refuses a second decision anyway, but a UI that kept offering one
    // would be inviting a reviewer to undo their own call by accident.
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
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
    expect(screen.getByText("[3 people]")).toBeInTheDocument();
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
    expect(screen.getByText("[1 person]")).toBeInTheDocument();
  });

  it("says nobody reported a row the classifier raised", () => {
    renderQueue([
      row({ source: "classifier", reporterCount: 0, reasons: [] }),
    ]);

    // A classifier row has no people behind it. Rendering an empty reason
    // list would read as a report with nothing written on it.
    expect(screen.getByText("Nobody reported this.")).toBeInTheDocument();
    expect(screen.getByText("[classifier]")).toBeInTheDocument();
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

    // `/safety/review-photo/`, not `/feed/photo/`. Every photo in this
    // queue is hidden precisely because somebody reported it, so the
    // ordinary route refuses it — pointing at that one would give a
    // reviewer a broken image on the subject that most needs looking at.
    const photo = screen.getByRole("img", { name: "Reported photo" });
    expect(photo).toHaveAttribute(
      "src",
      "/safety/review-photo/entries/u-1/e-1/p-1",
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
    expect(screen.getAllByRole("img", { name: "Reported photo" })).toHaveLength(
      2,
    );
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
    renderQueue([
      row({ subjectId: "e-404", subject: { photoKeys: [] } }),
    ]);

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
      screen.queryByRole("img", { name: "Reported photo" }),
    ).not.toBeInTheDocument();

    // And no empty container either. The row is a flex column with a gap,
    // so an element with nothing in it is not nothing — it is a blank
    // band between the subject and the reasons, on every row that is a
    // runner or a product rather than a photo.
    const empties = [...screen.getByRole("listitem").querySelectorAll("span")]
      .filter((node) => node.childElementCount === 0 && node.textContent === "");
    expect(empties).toEqual([]);
  });
});
