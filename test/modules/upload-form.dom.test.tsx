import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ImportOutcome } from "../../src/modules/runs/imports";
import { UploadForm } from "../../src/modules/runs/components/UploadForm";
import type { Retime } from "../../src/modules/runs/components/ParsedCard";
import {
  NO_TRACK_MESSAGE,
  PARSE_FAILURE_MESSAGE,
} from "../../src/modules/runs/upload-limits";
import { expectBusy } from "../ui/unavailable";
import {
  RUN_ID,
  SAT_MORNING,
  renderWithRouter,
  runConditions,
  runSummary,
} from "./run-fixtures";

/**
 * A1, in place (round 22): every outcome of an upload renders in the step
 * itself — the well breathing while it reads, the parsed card or a
 * duplicate's receipt where the well was, a parse failure on the well, a
 * stall on the form's band. Nothing navigates.
 */

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

function gpx(name = "run.gpx", body = "<gpx/>"): File {
  return new File([body], name, { type: "application/gpx+xml" });
}

function dropInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    "[data-part='drop-zone'] input[type='file']",
  );
  if (input === null) throw new Error("no drop zone input");
  return input;
}

function well(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[data-part='drop-zone']");
  if (found === null) throw new Error("no drop zone");
  return found;
}

/**
 * SQL NULL, as the import row carries an absent reason — parsed rather
 * than typed, because the lint's rule against `null` is right everywhere
 * except where a column says it.
 */
const NO_REASON = z.null().parse(JSON.parse("null"));

function outcome(overrides: Partial<ImportOutcome> = {}): ImportOutcome {
  return {
    status: "pending",
    failureReason: NO_REASON,
    run: undefined,
    ...overrides,
  };
}

/**
A read that never answers — an import still being looked for.
*/
function neverAnswers(): Promise<ImportOutcome | undefined> {
  return new Promise(() => {
    // deliberately never settled
  });
}

function parsed(overrides: Parameters<typeof runSummary>[0] = {}) {
  return () =>
    Promise.resolve(outcome({ status: "done", run: runSummary(overrides) }));
}

function region(slot: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-slot='${CSS.escape(slot)}']`,
  );
  if (found === null) throw new Error(`no ${slot}`);
  return found;
}

type Upload = (input: { data: FormData }) => Promise<{ importId: string }>;
type GetOutcome = (input: {
  data: { importId: string };
}) => Promise<ImportOutcome | undefined>;

function form(
  overrides: {
    upload?: Upload;
    getOutcome?: GetOutcome;
    retime?: Retime;
    units?: { temp: "f" | "c"; distance: "mi" | "km" };
  } = {},
) {
  return (
    <UploadForm
      upload={
        overrides.upload ?? (() => Promise.resolve({ importId: "01IMPORT" }))
      }
      getOutcome={overrides.getOutcome ?? (() => Promise.resolve(outcome()))}
      retime={overrides.retime ?? (() => Promise.resolve(true))}
      units={overrides.units ?? { temp: "f", distance: "mi" }}
    />
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("A1 at rest", () => {
  it("is the drop zone, in the board's words, taking the three file types", async () => {
    await renderWithRouter(form());

    expect(well()).toHaveAttribute("data-state", "empty");
    expect(well()).toHaveTextContent("GPX / TCX / FIT");
    expect(well()).toHaveTextContent("Drop a file, or browse");
    expect(well()).toHaveTextContent(
      "From your watch export or any tracking app.",
    );
    expect(dropInput()).toHaveAttribute("accept", ".fit,.gpx,.tcx");
  });

  it("holds no file name in the reading label it keeps in reserve", async () => {
    // The breathing label sits under the title, hidden, so the well does
    // not change size when a read starts. At rest it names nothing: a
    // stale name there would size the well to a file no longer in it.
    await renderWithRouter(form());

    expect(within(well()).getByText("Reading")).not.toBeVisible();
  });

  it("says to let go while a file is held over it", async () => {
    await renderWithRouter(form());

    fireEvent.dragOver(well());

    expect(well()).toHaveAttribute("data-state", "drag-over");
    expect(within(well()).getByText("Let go to read it")).toBeVisible();
  });
});

describe("A1: a file refused before it is sent", () => {
  it.each([
    [
      "a wrong type",
      new File(["x"], "run.csv"),
      "That's not a GPX, TCX or FIT file.",
    ],
    ["an empty file", new File([], "run.gpx"), "That file is empty."],
  ])("marks the well for %s, and sends nothing", async (_, file, sentence) => {
    const user = userEvent.setup({ applyAccept: false });
    const upload = vi.fn<Upload>();
    await renderWithRouter(form({ upload }));

    await user.upload(dropInput(), file);

    expect(screen.getByText(sentence)).toBeVisible();
    expect(well()).toHaveAttribute("data-state", "error");
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses a file over the cap by its size", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form());

    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "long.gpx");
    await user.upload(dropInput(), big);

    expect(screen.getByText("That file is larger than 25 MB.")).toBeVisible();
  });

  it("clears the mark when a good file follows", async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderWithRouter(form({ getOutcome: neverAnswers }));

    await user.upload(dropInput(), new File(["x"], "run.csv"));
    await user.upload(dropInput(), gpx());

    expect(screen.queryByText("That's not a GPX, TCX or FIT file.")).toBeNull();
  });

  it("does nothing when the picker is dismissed", async () => {
    const user = userEvent.setup();
    const upload = vi.fn<Upload>();
    await renderWithRouter(form({ upload }));

    await user.upload(dropInput(), []);

    expect(upload).not.toHaveBeenCalled();
    expect(well()).toHaveAttribute("data-state", "empty");
  });

  it.each([
    // An input's `files` is typed `FileList | null`; the null is parsed
    // for the same reason as `NO_REASON`'s.
    ["no file list at all", z.null().parse(JSON.parse("null"))],
    ["an empty file list", []],
  ])("takes %s quietly, without throwing", async (_, files) => {
    const upload = vi.fn<Upload>();
    const thrown: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      thrown.push(event.error);
      event.preventDefault();
    };
    globalThis.addEventListener("error", onError);
    await renderWithRouter(form({ upload }));

    try {
      fireEvent.change(dropInput(), { target: { files } });
    } finally {
      globalThis.removeEventListener("error", onError);
    }

    expect(thrown).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
    expect(well()).toHaveAttribute("data-state", "empty");
  });

  it("drops the last refusal the moment a good file starts sending", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const pending = Promise.withResolvers<{ importId: string }>();
    await renderWithRouter(form({ upload: () => pending.promise }));

    await user.upload(dropInput(), new File(["x"], "run.csv"));
    await user.upload(dropInput(), gpx("good.gpx"));

    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(screen.queryByText("That's not a GPX, TCX or FIT file.")).toBeNull();
    pending.resolve({ importId: "01IMPORT" });
  });

  it("drops a failed send's band when a refused file follows it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderWithRouter(
      form({ upload: () => Promise.reject(new TypeError("Failed to fetch")) }),
    );
    await user.upload(dropInput(), gpx());
    await screen.findByText("Nothing saved");

    await user.upload(dropInput(), new File(["x"], "run.csv"));

    expect(
      screen.getByText("That's not a GPX, TCX or FIT file."),
    ).toBeVisible();
    expect(screen.queryByText("Nothing saved")).toBeNull();
  });

  it("puts a refused file on the well in a failed read's place", async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderWithRouter(
      form({
        getOutcome: () => Promise.resolve(outcome({ status: "failed" })),
      }),
    );
    await user.upload(dropInput(), gpx());
    await screen.findByText(PARSE_FAILURE_MESSAGE);

    await user.upload(dropInput(), new File(["x"], "run.csv"));

    expect(
      screen.getByText("That's not a GPX, TCX or FIT file."),
    ).toBeVisible();
    expect(screen.queryByText(PARSE_FAILURE_MESSAGE)).toBeNull();
  });
});

describe("A1: sending and reading", () => {
  it("sends the file under a fresh key, and breathes its name while it goes", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ importId: string }>();
    const upload = vi.fn<Upload>(() => pending.promise);
    await renderWithRouter(form({ upload }));

    await user.upload(dropInput(), gpx("morning.gpx"));

    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(within(well()).getByText("Reading morning.gpx")).toBeVisible();
    expectBusy(dropInput());
    const sent = upload.mock.calls[0]?.[0].data;
    expect(sent?.get("file")).toEqual(
      expect.objectContaining({ name: "morning.gpx" }),
    );
    expect(sent?.get("idempotencyKey")).toMatch(ULID);

    // A second file mid-send is not a second upload.
    await user.upload(dropInput(), gpx("other.gpx"));
    expect(upload).toHaveBeenCalledTimes(1);
    pending.resolve({ importId: "01IMPORT" });
  });

  it("keeps breathing while the file is read, and never navigates", async () => {
    const user = userEvent.setup();
    const getOutcome = vi.fn<GetOutcome>(() => Promise.resolve(outcome()));
    const { router } = await renderWithRouter(form({ getOutcome }));

    await user.upload(dropInput(), gpx());

    await waitFor(() => {
      expect(getOutcome).toHaveBeenCalledWith({
        data: { importId: "01IMPORT" },
      });
    });
    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(within(well()).getByText("Reading run.gpx")).toBeVisible();
    expect(router.state.location.pathname).toBe("/");
  });

  it("puts a dropped connection on the form's band, and resends the same upload", async () => {
    const user = userEvent.setup();
    const upload = vi
      .fn<Upload>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ importId: "01IMPORT" });
    await renderWithRouter(form({ upload, getOutcome: neverAnswers }));

    await user.upload(dropInput(), gpx());

    expect(await screen.findByText("Nothing saved")).toBeVisible();
    expect(screen.getByText("Your connection dropped.")).toBeVisible();
    // The well returns to rest: the fix is not another file.
    expect(well()).toHaveAttribute("data-state", "empty");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(2);
    });
    const [first, second] = upload.mock.calls.map((call) => call[0].data);
    expect(second?.get("idempotencyKey")).toBe(first?.get("idempotencyKey"));
    expect(second?.get("file")).toBe(first?.get("file"));
    expect(screen.queryByText("Nothing saved")).toBeNull();
  });

  it("calls a slow read slow after twenty seconds, and tries again under the same key", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    const upload = vi.fn<Upload>(() =>
      Promise.resolve({ importId: "01IMPORT" }),
    );
    await renderWithRouter(form({ upload }));

    await user.upload(dropInput(), gpx());
    await waitFor(() => {
      expect(well()).toHaveAttribute("data-state", "uploading");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_000);
    });
    expect(
      screen.queryByText("Our end is slow. Your file is fine."),
    ).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(
      screen.getByText("Our end is slow. Your file is fine."),
    ).toBeVisible();
    expect(screen.getByText("Nothing saved")).toBeVisible();
    // The well stops claiming to read: the band says what is true.
    expect(well()).toHaveAttribute("data-state", "empty");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(2);
    });
    const [first, second] = upload.mock.calls.map((call) => call[0].data);
    expect(second?.get("file")).toBe(first?.get("file"));
    // The same key: the first import is still in the queue, and a new key
    // would parse the file twice and call the runner's own retry "Already
    // logged".
    expect(second?.get("idempotencyKey")).toBe(first?.get("idempotencyKey"));
  });

  it("never calls an idle form slow", async () => {
    // The stall clock is the read's, not the page's: a runner who opens
    // A1 and wanders off has sent nothing that could be slow.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithRouter(form({}));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });

    expect(
      screen.queryByText("Our end is slow. Your file is fine."),
    ).toBeNull();
    expect(well()).toHaveAttribute("data-state", "empty");
  });

  it("leaves no timer behind once it is gone, mid-read", async () => {
    // Two timers outlived the form. The stall timer was left to fire,
    // and react-query's default scheduled a five-minute collection of a
    // cache that only this form's own client could ever reach. Both fired
    // into a torn-down window in this project (test/dom-setup.ts).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const upload = vi.fn<Upload>(() =>
      Promise.resolve({ importId: "01IMPORT" }),
    );
    await renderWithRouter(form({ upload }));
    fireEvent.change(dropInput(), { target: { files: [gpx()] } });
    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(well()).toHaveAttribute("data-state", "uploading");
    });

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives a retried import twenty seconds of its own before calling it slow again", async () => {
    // The retry comes back to the same import (same key), so the stall has
    // to be reset by the send, not by a new import id.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    const upload = vi.fn<Upload>(() =>
      Promise.resolve({ importId: "01IMPORT" }),
    );
    await renderWithRouter(form({ upload, getOutcome: neverAnswers }));
    await user.upload(dropInput(), gpx());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(well()).toHaveAttribute("data-state", "uploading");
    });
    expect(
      screen.queryByText("Our end is slow. Your file is fine."),
    ).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(
      screen.getByText("Our end is slow. Your file is fine."),
    ).toBeVisible();
  });

  it("counts failed polls against the budget, so a dead endpoint is not asked forever", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getOutcome = vi
      .fn<GetOutcome>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    await renderWithRouter(form({ getOutcome }));
    await user.upload(dropInput(), gpx());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    const asked = getOutcome.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });

    expect(asked).toBeGreaterThan(0);
    expect(getOutcome.mock.calls).toHaveLength(asked);
  });

  it("keeps asking after a poll that failed, and lands the card when the answer comes", async () => {
    // A first poll that errors leaves no answer at all, which used to read
    // as settled and stop the polling for good.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getOutcome = vi
      .fn<GetOutcome>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(outcome({ status: "done", run: runSummary() }));
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    await renderWithRouter(form({ getOutcome }));
    await user.upload(dropInput(), gpx());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(screen.getByText("Parsed · run.gpx")).toBeVisible();
    expect(getOutcome.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("clears a failed send's band as soon as the next file starts", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ importId: string }>();
    const upload = vi
      .fn<Upload>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(form({ upload }));
    await user.upload(dropInput(), gpx());
    await screen.findByText("Nothing saved");

    await user.upload(dropInput(), gpx("next.gpx"));

    expect(within(well()).getByText("Reading next.gpx")).toBeVisible();
    expect(screen.queryByText("Nothing saved")).toBeNull();
    pending.resolve({ importId: "01IMPORT" });
  });

  it("leaves a failed read behind the moment another file is sent", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ importId: string }>();
    const upload = vi
      .fn<Upload>()
      .mockResolvedValueOnce({ importId: "01IMPORT" })
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(
      form({
        upload,
        getOutcome: () => Promise.resolve(outcome({ status: "failed" })),
      }),
    );
    await user.upload(dropInput(), gpx());
    await screen.findByText(PARSE_FAILURE_MESSAGE);

    await user.upload(dropInput(), gpx("better.gpx"));

    expect(within(well()).getByText("Reading better.gpx")).toBeVisible();
    expect(screen.queryByText(PARSE_FAILURE_MESSAGE)).toBeNull();
    pending.resolve({ importId: "02IMPORT" });
  });

  it("never shows a new import the last one's answer", async () => {
    const user = userEvent.setup();
    const upload = vi
      .fn<Upload>()
      .mockResolvedValueOnce({ importId: "01IMPORT" })
      .mockResolvedValueOnce({ importId: "02IMPORT" });
    const answers = parsed();
    await renderWithRouter(
      form({
        upload,
        getOutcome: ({ data }) =>
          data.importId === "01IMPORT" ? answers() : neverAnswers(),
      }),
    );
    await user.upload(dropInput(), gpx());
    await screen.findByText("Parsed · run.gpx");
    await user.click(screen.getByRole("button", { name: "Replace" }));

    await user.upload(dropInput(), gpx("second.gpx"));

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(2);
    });
    expect(await within(well()).findByText("Reading second.gpx")).toBeVisible();
    expect(document.querySelector("[data-slot='parsed-card']")).toBeNull();
  });

  it("keeps reading while the row says so, even once it names its run", async () => {
    const user = userEvent.setup();
    const getOutcome = vi.fn<GetOutcome>(() =>
      Promise.resolve(outcome({ status: "pending", run: runSummary() })),
    );
    await renderWithRouter(form({ getOutcome }));

    await user.upload(dropInput(), gpx());
    await waitFor(() => {
      expect(getOutcome).toHaveBeenCalled();
    });
    // Long enough for the answer to be rendered, however it renders.
    await act(async () => {
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 50);
      });
    });

    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(document.querySelector("[data-slot='parsed-card']")).toBeNull();
  });
});

describe("A1: a file that would not parse", () => {
  it("names the file when it had no track in it", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        getOutcome: () =>
          Promise.resolve(
            outcome({ status: "failed", failureReason: NO_TRACK_MESSAGE }),
          ),
      }),
    );

    await user.upload(dropInput(), gpx("MORNING_RUN.GPX"));

    expect(
      await screen.findByText(
        "MORNING_RUN.GPX has no track in it. Export the run again.",
      ),
    ).toBeVisible();
    expect(well()).toHaveAttribute("data-state", "error");
  });

  it("says it could not read one with no reason recorded", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        getOutcome: () => Promise.resolve(outcome({ status: "failed" })),
      }),
    );

    await user.upload(dropInput(), gpx());

    expect(await screen.findByText(PARSE_FAILURE_MESSAGE)).toBeVisible();
  });

  it("takes another file straight from the marked well", async () => {
    const user = userEvent.setup();
    const upload = vi.fn<Upload>(() =>
      Promise.resolve({ importId: "01IMPORT" }),
    );
    await renderWithRouter(
      form({
        upload,
        getOutcome: () => Promise.resolve(outcome({ status: "failed" })),
      }),
    );
    await user.upload(dropInput(), gpx());
    await screen.findByText(PARSE_FAILURE_MESSAGE);

    await user.upload(dropInput(), gpx("better.gpx"));

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(2);
    });
  });
});

describe("A1: the parsed card", () => {
  it("lands in place: the file, the run, and its conditions", async () => {
    const user = userEvent.setup();
    const { router } = await renderWithRouter(form({ getOutcome: parsed() }));

    await user.upload(dropInput(), gpx("morning.gpx"));

    const strip = await screen.findByText("Parsed · morning.gpx");
    const card = region("parsed-card");
    expect(card).toContainElement(strip);
    expect(card).toHaveAttribute("data-state", "parsed");
    expect(within(card).getByText("6.2 mi · 51:38")).toBeVisible();
    expect(within(card).getByText("8:20 /mi")).toBeVisible();
    expect(within(card).getByText("Sat Aug 29")).toBeVisible();
    expect(
      within(card).getByRole("button", {
        name: "Started 6:04 AM — change the time",
      }),
    ).toHaveTextContent("6:04 AM");
    expect(document.querySelector("[data-part='drop-zone']")).toBeNull();

    // The conditions block, read-only, with the correction's note.
    const conditions = document.querySelector("[data-slot='conditions']");
    expect(conditions).toHaveTextContent("Conditions · auto-attached");
    expect(conditions).toHaveTextContent("41°F");
    expect(conditions).toHaveTextContent(
      "Never typed by hand. Wrong time? Tap it on the run card and we’ll refetch.",
    );
    expect(conditions?.querySelector("input")).toBeNull();

    const next = screen.getByRole("link", {
      name: "Looks right — what did you wear?",
    });
    expect(next).toHaveAttribute("href", `/feed/attach/${RUN_ID}`);
    expect(router.state.location.pathname).toBe("/");
  });

  it("breathes in the conditions' place while the weather is asked for, then shows it", async () => {
    const user = userEvent.setup();
    const getOutcome = vi
      .fn<GetOutcome>()
      .mockResolvedValueOnce(
        outcome({
          status: "done",
          run: runSummary({ weatherStatus: "pending", conditions: undefined }),
        }),
      )
      .mockResolvedValue(outcome({ status: "done", run: runSummary() }));
    await renderWithRouter(form({ getOutcome }));

    await user.upload(dropInput(), gpx());

    expect(await screen.findByText("Fetching weather")).toBeVisible();
    expect(
      await screen.findByText("Conditions · auto-attached", undefined, {
        timeout: 4000,
      }),
    ).toBeVisible();
  });

  it("says so when the weather never came, and offers nothing to type", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        getOutcome: parsed({
          weatherStatus: "failed",
          conditions: undefined,
          canSetConditions: true,
        }),
      }),
    );

    await user.upload(dropInput(), gpx());

    expect(await screen.findByText("No conditions")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Set ›" })).toBeNull();
  });

  it("goes back to the drop zone on REPLACE — the only way back", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form({ getOutcome: parsed() }));
    await user.upload(dropInput(), gpx());
    await screen.findByText("Parsed · run.gpx");

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(well()).toHaveAttribute("data-state", "empty");
    expect(document.querySelector("[data-slot='parsed-card']")).toBeNull();
  });

  it("moves the start to the time the runner picks, on the run's own clock, and asks again", async () => {
    const user = userEvent.setup();
    const retime = vi.fn<Retime>(() => Promise.resolve(true));
    const getOutcome = vi.fn<GetOutcome>(parsed());
    await renderWithRouter(form({ getOutcome, retime }));
    await user.upload(dropInput(), gpx());
    await screen.findByText("Parsed · run.gpx");
    const asked = getOutcome.mock.calls.length;

    const time = screen.getByRole("button", { name: /change the time/u });
    expect(time).toHaveAttribute("aria-expanded", "false");
    await user.click(time);
    expect(time).toHaveAttribute("aria-expanded", "true");

    const field = screen.getByLabelText("Started");
    // The run's own clock: 6:04 in Chicago, not 11:04 UTC.
    expect(field).toHaveValue("06:04");
    await user.clear(field);
    await user.type(field, "07:34");
    await user.click(screen.getByRole("button", { name: "Refetch" }));

    await waitFor(() => {
      expect(retime).toHaveBeenCalledWith({
        data: { runId: RUN_ID, startedAt: SAT_MORNING + 90 * 60 },
      });
    });
    await waitFor(() => {
      expect(screen.queryByLabelText("Started")).toBeNull();
    });
    expect(getOutcome.mock.calls.length).toBeGreaterThan(asked);
  });

  it("closes the time field on a second tap, sending nothing", async () => {
    const user = userEvent.setup();
    const retime = vi.fn<Retime>(() => Promise.resolve(true));
    await renderWithRouter(form({ getOutcome: parsed(), retime }));
    await user.upload(dropInput(), gpx());
    const time = await screen.findByRole("button", {
      name: /change the time/u,
    });

    await user.click(time);
    await user.click(time);

    expect(screen.queryByLabelText("Started")).toBeNull();
    expect(retime).not.toHaveBeenCalled();
  });

  it("asks for a time when the field is emptied, in the schema's words", async () => {
    const user = userEvent.setup();
    const retime = vi.fn<Retime>(() => Promise.resolve(true));
    await renderWithRouter(form({ getOutcome: parsed(), retime }));
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: /change the time/u }),
    );

    await user.clear(screen.getByLabelText("Started"));
    await user.click(screen.getByRole("button", { name: "Refetch" }));

    expect(
      await screen.findByText("Pick the time the run started."),
    ).toBeVisible();
    expect(screen.getByLabelText("Started")).toHaveAccessibleDescription(
      "Pick the time the run started.",
    );
    expect(retime).not.toHaveBeenCalled();
  });

  it("says the time moved, and keeps the page where it is", async () => {
    const user = userEvent.setup();
    const submitted: SubmitEvent[] = [];
    const onSubmit = (event: SubmitEvent) => {
      submitted.push(event);
    };
    document.addEventListener("submit", onSubmit);
    try {
      await renderWithRouter(form({ getOutcome: parsed() }));
      await user.upload(dropInput(), gpx());
      await user.click(
        await screen.findByRole("button", { name: /change the time/u }),
      );

      await user.click(screen.getByRole("button", { name: "Refetch" }));

      expect(
        await screen.findByText("Time changed. Fetching the weather for it."),
      ).toBeInTheDocument();
      expect(submitted.map((event) => event.defaultPrevented)).toEqual([true]);
    } finally {
      document.removeEventListener("submit", onSubmit);
    }
  });

  it("reads a run with no conditions on the runner's own clock, not UTC", async () => {
    // A treadmill, no GPS, or weather that never came: no zone of its own.
    // 11:04 UTC is 4:04 in the morning for a runner in Los Angeles, and
    // that is the clock they read the start from.
    const resolved = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...resolved,
      timeZone: "America/Los_Angeles",
    });
    const user = userEvent.setup();
    const retime = vi.fn<Retime>(() => Promise.resolve(true));
    await renderWithRouter(
      form({
        getOutcome: parsed({ weatherStatus: "failed", conditions: undefined }),
        retime,
      }),
    );
    await user.upload(dropInput(), gpx());

    const time = await screen.findByRole("button", {
      name: /change the time/u,
    });
    expect(time).toHaveTextContent("4:04 AM");
    await user.click(time);
    const field = screen.getByLabelText("Started");
    expect(field).toHaveValue("04:04");
    await user.clear(field);
    await user.type(field, "05:04");
    await user.click(screen.getByRole("button", { name: "Refetch" }));

    await waitFor(() => {
      expect(retime).toHaveBeenCalledWith({
        data: { runId: RUN_ID, startedAt: SAT_MORNING + 3600 },
      });
    });
  });

  it("sends the same start when the correction is tried again", async () => {
    // A response lost on the way back: the retry must not move the run a
    // second time, which a relative shift did.
    const user = userEvent.setup();
    const retime = vi
      .fn<Retime>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(true);
    await renderWithRouter(form({ getOutcome: parsed(), retime }));
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: /change the time/u }),
    );
    const field = screen.getByLabelText("Started");
    await user.clear(field);
    await user.type(field, "07:34");
    await user.click(screen.getByRole("button", { name: "Refetch" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(retime).toHaveBeenCalledTimes(2);
    });
    const sent = retime.mock.calls.map((call) => call[0].data.startedAt);
    expect(sent).toStrictEqual([SAT_MORNING + 90 * 60, SAT_MORNING + 90 * 60]);
  });

  it("splits the facts with a rule between each, never before the first", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form({ getOutcome: parsed() }));
    await user.upload(dropInput(), gpx());

    const pace = await screen.findByText("8:20 /mi");

    expect(pace.closest("p")).toHaveTextContent(
      /^8:20 \/mi\|Sat Aug 29\|6:04 AM$/u,
    );
  });
});

describe("A1: a run already logged", () => {
  it("is a receipt in the card's place, from the existing run", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        getOutcome: () =>
          Promise.resolve(outcome({ status: "duplicate", run: runSummary() })),
      }),
    );

    await user.upload(dropInput(), gpx("MORNING_RUN_0829.GPX"));

    const kicker = await screen.findByText("Already logged");
    const card = region("parsed-card");
    expect(card).toContainElement(kicker);
    expect(card).toHaveAttribute("data-state", "duplicate");
    expect(within(card).getByText("MORNING_RUN_0829.GPX")).toBeVisible();
    expect(within(card).getByText("6.2 mi · 51:38")).toBeVisible();
    expect(within(card).getByText("Sat Aug 29")).toBeVisible();
    expect(within(card).getByText("6:04 AM")).toBeVisible();
    expect(within(card).getByText("41°F damp")).toHaveClass("text-dialed-text");
    expect(
      within(card).getByText(
        "This run is already in your log. Nothing new was added.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Wrong file? Tap Replace above.")).toBeVisible();
    // No conditions block: they are already the run's.
    expect(document.querySelector("[data-slot='conditions']")).toBeNull();
  });

  it("opens A2 for a run with no kit, in ink rather than the log verb's pink", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        getOutcome: () =>
          Promise.resolve(outcome({ status: "duplicate", run: runSummary() })),
      }),
    );
    await user.upload(dropInput(), gpx());

    const open = await screen.findByRole("link", { name: "Open that run" });
    expect(open).toHaveAttribute("href", `/feed/attach/${RUN_ID}`);
    expect(open).toHaveClass("bg-ink", "text-ground");
  });

  it("opens the run itself when it already has an entry", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        getOutcome: () =>
          Promise.resolve(
            outcome({
              status: "duplicate",
              run: runSummary({ entryId: "01ENTRY", conditions: undefined }),
            }),
          ),
      }),
    );
    await user.upload(dropInput(), gpx());

    const open = await screen.findByRole("link", { name: "Open that run" });
    expect(open).toHaveAttribute("href", `/runs/${RUN_ID}`);
    expect(open).toHaveClass("bg-ink");
    // With no conditions the facts are the day and the time alone.
    expect(screen.queryByText(/°F/u)).toBeNull();
  });

  it("goes back to the drop zone on REPLACE", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        getOutcome: () =>
          Promise.resolve(outcome({ status: "duplicate", run: runSummary() })),
      }),
    );
    await user.upload(dropInput(), gpx());
    await screen.findByText("Already logged");

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(well()).toHaveAttribute("data-state", "empty");
  });
});

const FIVE_DEGREES = runConditions({ tempC: 5 });

describe("A1: the units are the runner's", () => {
  it("writes kilometres and Celsius for a runner who uses them", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        units: { temp: "c", distance: "km" },
        getOutcome: parsed({ conditions: FIVE_DEGREES }),
      }),
    );

    await user.upload(dropInput(), gpx());

    expect(await screen.findByText("10.0 km · 51:38")).toBeVisible();
    expect(screen.getByText("5:10 /km")).toBeVisible();
    expect(
      document.querySelector("[data-slot='conditions']"),
    ).toHaveTextContent("5°C");
  });
});
