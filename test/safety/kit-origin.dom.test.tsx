import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type KitOrigin,
  useReturnToRow,
} from "../../src/modules/safety/components/kit-origin";

/**
 * Round 52 #155.5: back from a kit, the row its back link names takes
 * focus, and the list hears which row it was.
 */
function Rows({
  from,
  onRow,
  ids,
}: Readonly<{
  from: KitOrigin["from"];
  onRow: (row: string) => void;
  ids: readonly string[];
}>) {
  useReturnToRow(from, onRow);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id} id={id} tabIndex={-1}>
          {id}
        </li>
      ))}
    </ul>
  );
}

afterEach(() => {
  globalThis.location.hash = "";
});

describe("useReturnToRow", () => {
  it("focuses the row the hash names, whatever its id holds", () => {
    // A row id may hold a character a selector reads as syntax: the dot
    // here would make "#report-a.b" a class selector.
    globalThis.location.hash = "#report-a.b";
    const onRow = vi.fn();
    render(
      <Rows from="report" onRow={onRow} ids={["report-a", "report-a.b"]} />,
    );

    expect(onRow).toHaveBeenCalledExactlyOnceWith("a.b");
    expect(screen.getByText("report-a.b")).toHaveFocus();
  });

  it("does nothing with no row in the hash", () => {
    const onRow = vi.fn();
    render(<Rows from="report" onRow={onRow} ids={["report-a"]} />);

    expect(onRow).not.toHaveBeenCalled();
    expect(document.body).toHaveFocus();
  });

  it("says which row, and moves nothing, when that row is no longer listed", () => {
    globalThis.location.hash = "#report-gone";
    const onRow = vi.fn();
    render(<Rows from="report" onRow={onRow} ids={["report-a"]} />);

    expect(onRow).toHaveBeenCalledExactlyOnceWith("gone");
    expect(document.body).toHaveFocus();
  });

  it("looks again when the list it answers for changes", () => {
    globalThis.location.hash = "#report-a";
    const onRow = vi.fn();
    const { rerender } = render(
      <Rows from="request" onRow={onRow} ids={["report-a"]} />,
    );
    expect(onRow).not.toHaveBeenCalled();

    rerender(<Rows from="report" onRow={onRow} ids={["report-a"]} />);
    expect(onRow).toHaveBeenCalledExactlyOnceWith("a");
    expect(screen.getByText("report-a")).toHaveFocus();
  });
});
