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
