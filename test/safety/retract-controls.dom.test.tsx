import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { RetractEntry } from "../../src/modules/feed/components/RetractEntry";
import { DeleteRun } from "../../src/modules/runs/components/DeleteRun";

/**
 * SAF-3's controls: who sees them, what each sheet says, what each one
 * sends, and what a failure leaves on screen.
 */

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const OWNER = "01OWNER";
const PHOTO_ID = "01JPHOTO0000000000000000AA";
const entry = {
  id: "01ENTRY",
  userId: OWNER,
  photoKeys: [
    `entries/${OWNER}/01ENTRY/01JPHOTO0000000000000000ZZ`,
    `entries/${OWNER}/01ENTRY/${PHOTO_ID}`,
  ],
};

function retractEntry(overrides: {
  viewerId?: string;
  retract?: () => Promise<unknown>;
  deletePhoto?: () => Promise<unknown>;
  onRetracted?: () => Promise<void>;
}) {
  return (
    <RetractEntry
      entry={entry}
      viewerId={overrides.viewerId ?? OWNER}
      retract={overrides.retract ?? vi.fn(() => Promise.resolve())}
      deletePhoto={overrides.deletePhoto ?? vi.fn(() => Promise.resolve())}
      onRetracted={overrides.onRetracted ?? vi.fn(() => Promise.resolve())}
    />
  );
}

describe("RetractEntry", () => {
  it("offers nothing to anyone but the owner", async () => {
    await renderWithRouter(retractEntry({ viewerId: "01STRANGER" }));
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("offers the owner each photo, numbered, and the entry", async () => {
    await renderWithRouter(retractEntry({}));
    expect(
      screen
        .getAllByRole("button", { name: /^Delete/ })
        .map((b) => b.textContent),
    ).toStrictEqual(["Delete photo 1", "Delete photo 2", "Delete this entry"]);
  });

  it("deletes the entry once confirmed, then leaves the page", async () => {
    const retract = vi.fn(() => Promise.resolve());
    const onRetracted = vi.fn(() => Promise.resolve());
    await renderWithRouter(retractEntry({ retract, onRetracted }));

    fireEvent.click(screen.getByRole("button", { name: "Delete this entry" }));
    expect(
      screen.getByRole("heading", { name: "Delete this entry?" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Its kit, verdict and photos go, and it leaves every feed. The run stays. This can't be undone.",
      ),
    ).toBeTruthy();
    expect(retract).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(onRetracted).toHaveBeenCalledTimes(1);
    });
    expect(retract).toHaveBeenCalledWith({ data: { entryId: "01ENTRY" } });
  });

  it("deletes the photo it was opened for, by the id its key ends in", async () => {
    const deletePhoto = vi.fn(() => Promise.resolve());
    await renderWithRouter(retractEntry({ deletePhoto }));

    fireEvent.click(screen.getByRole("button", { name: "Delete photo 2" }));
    expect(
      screen.getByRole("heading", { name: "Delete photo 2?" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "It comes off this entry and out of storage. This can't be undone.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Delete photo 2?" }),
      ).toBeNull();
    });
    expect(deletePhoto).toHaveBeenCalledWith({ data: { photoId: PHOTO_ID } });
  });

  it("keeps the sheet open with the failure when the delete fails", async () => {
    const retract = vi.fn(() => Promise.reject(new Error("offline")));
    const onRetracted = vi.fn(() => Promise.resolve());
    await renderWithRouter(retractEntry({ retract, onRetracted }));

    fireEvent.click(screen.getByRole("button", { name: "Delete this entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getAllByText(/Not deleted/).length).toBeGreaterThan(0);
    });
    expect(onRetracted).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Delete this entry?" }),
    ).toBeTruthy();
  });

  it("says Photo kept when a photo's delete fails", async () => {
    const deletePhoto = vi.fn(() => Promise.reject(new Error("offline")));
    await renderWithRouter(retractEntry({ deletePhoto }));
    fireEvent.click(screen.getByRole("button", { name: "Delete photo 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getAllByText(/Photo kept/).length).toBeGreaterThan(0);
    });
  });

  it("closes on Keep it without deleting anything", async () => {
    const retract = vi.fn(() => Promise.resolve());
    await renderWithRouter(retractEntry({ retract }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(
      screen.queryByRole("heading", { name: "Delete this entry?" }),
    ).toBeNull();
    expect(retract).not.toHaveBeenCalled();
  });

  it("puts focus on Keep it when a sheet opens", async () => {
    await renderWithRouter(retractEntry({}));
    fireEvent.click(screen.getByRole("button", { name: "Delete this entry" }));
    await waitFor(() => {
      expect(globalThis.document.activeElement?.textContent).toBe("Keep it");
    });
  });
});

describe("DeleteRun", () => {
  it("deletes the run once confirmed, saying what goes with it", async () => {
    const deleteRun = vi.fn(() => Promise.resolve());
    const onDeleted = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <DeleteRun runId="01RUN" deleteRun={deleteRun} onDeleted={onDeleted} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete this run" }));
    expect(
      screen.getByRole("heading", { name: "Delete this run?" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Its entry, verdict and photos go with it, and so does any file you uploaded for it. This can't be undone.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });
    expect(deleteRun).toHaveBeenCalledWith({ data: { runId: "01RUN" } });
  });

  it("says Not deleted and stays when it fails", async () => {
    const deleteRun = vi.fn(() => Promise.reject(new Error("offline")));
    const onDeleted = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <DeleteRun runId="01RUN" deleteRun={deleteRun} onDeleted={onDeleted} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete this run" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getAllByText(/Not deleted/).length).toBeGreaterThan(0);
    });
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
