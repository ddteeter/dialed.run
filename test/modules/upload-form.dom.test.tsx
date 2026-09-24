import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { UploadForm } from "../../src/modules/runs/components/UploadForm";
import { expectAvailable, expectBusy } from "../ui/unavailable";

/**
 * Screen A1's file drop.
 *
 * Every line of this was uncovered until the upload action moved from an
 * import to a prop: the component reached `../functions`, which no test
 * can import.
 */
/**
 * A router with the import screen in it, so the redirect this component
 * performs has somewhere real to land and the test can read where it went.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const importRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/import/$importId",
    component: () => <p>Watching the import</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, importRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

function gpx(name = "run.gpx"): File {
  return new File(["<gpx/>"], name, { type: "application/gpx+xml" });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector("input[type='file']");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  return input;
}

describe("UploadForm", () => {
  it("says which files it takes, and how big", async () => {
    await renderWithRouter(
      <UploadForm upload={() => Promise.resolve({ importId: "x" })} />,
    );

    expect(screen.getByText("Drop a file, or browse")).toBeVisible();
    // A1's hint as round 19 draws it; "up to 25 MB" was round 13's, and
    // the current board supersedes it.
    expect(
      screen.getByText("From your watch export or any tracking app."),
    ).toBeVisible();
    // The input is visually hidden but still in the accessibility tree —
    // `sr-only`, not `hidden`, or a keyboard user cannot reach it.
    expect(fileInput()).toHaveClass("sr-only");
    expect(fileInput()).toHaveAttribute("accept", ".fit,.gpx,.tcx");
  });

  it("takes a dropped file, which its label has promised since round 13", async () => {
    // The label has said "Drop a …" since design's round-13 table named
    // it, and nothing listened: the input is `sr-only`, so a file dropped
    // on the dashed box it draws landed on the document and the browser
    // opened it — out of the flow, with the form gone. Desktop Contract
    // bend 1 is what makes the copy true.
    const upload = vi.fn().mockResolvedValue({ importId: "x" });
    await renderWithRouter(<UploadForm upload={upload} />);

    const well = screen.getByText("Drop a file, or browse").closest("label");
    expect(well).not.toBeNull();

    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([1])], "run.fit", {
        type: "application/octet-stream",
      }),
    );
    fireEvent.drop(well ?? document.body, { dataTransfer: transfer });

    // The same callback the input's own `onChange` calls — one path, so
    // the size check and the multipart body are reached identically.
    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
  });

  it("goes to solid ink while a file is over it, and says to let go", async () => {
    // Round 22 draws bend 1's "one state change" for A1 too: dashed to a
    // 2px solid ink border, the ground to the panel, and the title swaps
    // ("Let go to read it").
    await renderWithRouter(
      <UploadForm upload={() => Promise.resolve({ importId: "x" })} />,
    );

    const well = document.querySelector<HTMLElement>("[data-part='drop-zone']");
    expect(well).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("GPX / TCX / FIT")).toBeVisible();
    expect(screen.getByText("Reading")).not.toBeVisible();
    expect(
      screen.getByText("From your watch export or any tracking app."),
    ).toBeVisible();

    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1])], "run.fit"));
    fireEvent.dragOver(well ?? document.body, { dataTransfer: transfer });

    expect(well).toHaveAttribute("data-state", "drag-over");
    expect(screen.getByText("Let go to read it")).toBeInTheDocument();
  });

  it("sends the chosen file as multipart under the name the server reads", async () => {
    const user = userEvent.setup();
    const upload = vi.fn<
      (input: { data: FormData }) => Promise<{ importId: string }>
    >(() => Promise.resolve({ importId: "01IMPORT" }));
    await renderWithRouter(<UploadForm upload={upload} />);

    await user.upload(fileInput(), gpx());

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    const sent = upload.mock.calls[0]?.[0]?.data;
    expect(sent).toBeInstanceOf(FormData);
    // "file" is what `importUploadFrom` looks for; any other key is a
    // silent "No file was attached".
    expect(sent?.get("file")).toBeInstanceOf(File);
  });

  it("sends them to watch the import it just started", async () => {
    // The importId comes back from the server function and is the whole
    // point of the redirect: the next screen polls on it.
    const user = userEvent.setup();
    const router = await renderWithRouter(
      <UploadForm upload={() => Promise.resolve({ importId: "01IMPORT" })} />,
    );

    await user.upload(fileInput(), gpx());

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/runs/import/01IMPORT");
    });
    expect(await screen.findByText("Watching the import")).toBeVisible();
  });

  it("does nothing at all when the picker is dismissed", async () => {
    // `files?.[0] === undefined` — cancelling the dialog fires change with
    // an empty list, and starting an upload for it would be a request for
    // nothing.
    const upload = vi.fn(() => Promise.resolve({ importId: "x" }));
    await renderWithRouter(<UploadForm upload={upload} />);

    // An empty list is what the browser sends when the dialog is
    // cancelled — the event fires either way.
    fileInput().dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => {
      expect(screen.getByText("Drop a file, or browse")).toBeVisible();
    });

    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByText(/didn't upload/)).toBeNull();
  });

  it("ignores a second file chosen while the first is still uploading", async () => {
    // The guard rule 07 makes necessary, and an input is the sharp case:
    // `aria-disabled` does not stop a file picker opening the way
    // `disabled` did, so the second file has to die in the handler.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ importId: string }>();
    const upload = vi.fn(() => pending.promise);
    await renderWithRouter(<UploadForm upload={upload} />);

    await user.upload(fileInput(), gpx());
    await waitFor(() => {
      expectBusy(fileInput());
    });
    await user.upload(fileInput(), gpx());

    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("locks the input while it works", async () => {
    // A second file chosen mid-upload would race the first. On success the
    // screen changes, so the release that matters is the failure one,
    // which the retry case below covers.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ importId: string }>();
    const router = await renderWithRouter(
      <UploadForm upload={() => pending.promise} />,
    );

    await user.upload(fileInput(), gpx());

    await waitFor(() => {
      expectBusy(fileInput());
    });

    pending.resolve({ importId: "01IMPORT" });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/runs/import/01IMPORT");
    });
  });

  it("says so when the upload fails, and lets them try again", async () => {
    const user = userEvent.setup();
    const upload = vi
      .fn<() => Promise<{ importId: string }>>()
      .mockRejectedValueOnce(new Error("network went away"));
    await renderWithRouter(<UploadForm upload={upload} />);

    await user.upload(fileInput(), gpx());

    expect(
      await screen.findByText("That didn't upload. Try again."),
    ).toBeVisible();
    // Released, not stuck: the retry is choosing the file again.
    expectAvailable(fileInput());
  });

  it("clears the last failure as soon as a new file is chosen", async () => {
    // While the second attempt is still in flight, not after it lands: a
    // stale "that didn't upload" next to a running upload is a lie about
    // what is happening. The second attempt is left pending on purpose,
    // because a success navigates away and would unmount the message
    // whether it had been cleared or not.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ importId: string }>();
    const upload = vi
      .fn<() => Promise<{ importId: string }>>()
      .mockRejectedValueOnce(new Error("network went away"))
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(<UploadForm upload={upload} />);

    await user.upload(fileInput(), gpx());
    expect(await screen.findByText(/didn't upload/)).toBeVisible();

    await user.upload(fileInput(), gpx("second.gpx"));

    await waitFor(() => {
      expect(screen.queryByText(/didn't upload/)).toBeNull();
    });
    expectBusy(fileInput());
    pending.resolve({ importId: "01IMPORT" });
  });

  it("says nothing at rest, rather than reserving a line for an error", async () => {
    await renderWithRouter(
      <UploadForm upload={() => Promise.resolve({ importId: "x" })} />,
    );
    expect(screen.queryByRole("paragraph")).toBeNull();
  });
});

/**
 * The log flow's three screens are three routes, so the move that carries
 * "which way you are travelling" has to be on each of them — and a screen
 * that quietly loses its wrapper animates nothing, with nothing to say so.
 *
 * The wrapper is what is asserted, not a particular class. Round 12 made
 * the *arrival* a third state: entering the flow from the bar is the
 * router's `rise`, so `FlowStep` deliberately adds no class there, and a
 * screen rendered on its own — as here — is always entering.
 */
describe("UploadForm: the log flow", () => {
  it("is step one of the log flow, and enters from an edge", async () => {
    await renderWithRouter(
      <UploadForm upload={() => Promise.resolve({ importId: "x" })} />,
    );

    const step = document.querySelector("[data-flow-direction]");
    expect(step).not.toBeNull();
    // Mounted with no step before it, so this is the way in: the class is
    // absent precisely because the rise is the move.
    expect(step).toHaveAttribute("data-flow-direction", "entering");
    expect(step?.className).toBe("");
  });
});
