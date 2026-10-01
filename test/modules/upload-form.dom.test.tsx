import {
  act,
  cleanup,
  configure,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { z } from "zod";

import { importPollIntervalMs } from "../../src/modules/runs/import-polling";
import type { ImportOutcome } from "../../src/modules/runs/imports";
import { UploadForm } from "../../src/modules/runs/components/UploadForm";
import type { Retime } from "../../src/modules/runs/components/ParsedCard";
import {
  NO_TRACK_MESSAGE,
  PARSE_FAILURE_MESSAGE,
} from "../../src/modules/runs/upload-limits";
import { DURATION } from "../../src/ui/motion";
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
A promise that never settles.
*/
function never(): Promise<never> {
  return new Promise(() => {
    // deliberately never settled
  });
}

/**
A read that never answers — an import still being looked for.
*/
function neverAnswers(): Promise<ImportOutcome | undefined> {
  return never();
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

/**
 * Waits until the form is watching the import: its first poll has gone
 * out, so the poll and stall timers exist. Fake time advanced before that
 * jumps the clock over timers not yet set, and the poll and stall timers
 * land past the window instead of in it.
 */
async function firstPoll(getOutcome: Mock<GetOutcome>): Promise<void> {
  await waitFor(() => {
    expect(getOutcome).toHaveBeenCalled();
  });
}

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
      retime={overrides.retime ?? (() => Promise.resolve("moved"))}
      units={overrides.units ?? { temp: "f", distance: "mi" }}
    />
  );
}

/**
 * Every test in this file runs on a clock it owns, and the wall clock
 * decides nothing.
 *
 * A1 is made of timers — a poll every two seconds, a stall at twenty, a
 * grace before a success moves on — and these tests used to wait for them
 * in real time: most on the real clock inside `waitFor`'s one-second
 * budget (one at four seconds, to fit a real two-second poll), the rest on
 * a fake clock that `shouldAdvanceTime` also moved with the wall clock. So
 * a process that stopped being scheduled for a second or two — a loaded
 * machine, a push gate's dry run — failed whichever test it landed in.
 * When it resumes, every timer that came due during the pause fires in
 * order of due time, so `waitFor`'s deadline goes off before the work it
 * was waiting for, which only queues its next step once it runs.
 *
 * Now the clock moves only when a test moves it: `user-event` advances it
 * for its own pauses, `elapse` for the form's, and Testing Library's
 * `waitFor` — which recognises fake timers only through a global named
 * `jest` — steps it fifty milliseconds a turn, so its budget is counted in
 * fake time and a pause in the real world spends none of it. Only the
 * timers are faked: `Date` and `Intl` stay real, because the run's clock
 * is read through them and one test spies on `Intl` itself.
 */
const ONLY_TIMERS: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
};

/**
 * The test that owns the clock, for as long as it runs.
 *
 * This exists for a test that times out, whose body vitest does not stop.
 * It used to run on into the tests after it — parked in a `waitFor` whose
 * deadline had gone with the uninstalled clock, re-checking on every later
 * change to the page until one happened to pass, then advancing the next
 * test's clock inside an `act()` that overlapped the next test's own.
 * React keeps one depth counter for every `act()` in the file, and scopes
 * that overlap rather than nest leave it wrong for good: the queue is
 * never flushed again, and every render after that came up empty — one
 * slow test, then thirty-odd "no drop zone input" failures. So every move
 * of the clock is made on behalf of the test that started it, a test ends
 * only once its last move has, and a body that runs on past its test
 * stops at its next move and touches nothing.
 */
interface Owner {
  isOpen: boolean;
}
const clock: { owner: Owner; moving: Promise<void> | undefined } = {
  owner: { isOpen: false },
  moving: undefined,
};

/**
 * Moves the clock for `by`, inside `act()` so what it wakes lands. A body
 * that has outlived its test waits here forever instead, holding no
 * `act()`.
 */
function move(by: Owner, work: () => unknown): Promise<void> {
  if (!by.isOpen) return never();
  const step = act(async () => {
    await work();
  });
  clock.moving = step;
  return step;
}

beforeEach(() => {
  const test: Owner = { isOpen: true };
  clock.owner = test;
  vi.useFakeTimers(ONLY_TIMERS);
  vi.stubGlobal("jest", {
    advanceTimersByTime: (ms: number) => {
      vi.advanceTimersByTime(ms);
    },
  });
  // Read once by each `waitFor` as it starts, so a `waitFor` left running
  // by a timed-out test keeps the owner it started under.
  configure({ unstable_advanceTimersWrapper: (work) => move(test, work) });
});

/**
 * How long a form may go on finishing once it is gone: the longest motion
 * there is. What legitimately outlives an unmount here is a grace before a
 * success moves on (`useFormSubmit` waits `DURATION.instant`), and nothing
 * in the product animates longer than `reveal`. A timer still pending past
 * that is not a tail but a leak.
 */
const SETTLED_AFTER_MS = DURATION.reveal;

/**
 * Every test ends with the form unmounted and its timers run out, on this
 * file's clock.
 *
 * `test/dom-setup.ts` fails a file that leaves a timer pending, but it
 * watches only real timers, and in this file every timer is a fake one
 * that `useRealTimers` throws away. So a stall timer the form forgot to
 * clear, or a five-minute garbage collection its query client scheduled on
 * the way out, passed here unseen. This is that drain in fake time: unmount,
 * give whatever was finishing its last moment, and count what is left.
 *
 * It moves the clock under an owner of its own, once the test's last move
 * has landed, so a body that outlived its test cannot share the `act()`.
 */
afterEach(async () => {
  clock.owner.isOpen = false;
  try {
    await clock.moving;
  } catch {
    // The test has already failed, with its own error.
  }
  try {
    cleanup();
    await move({ isOpen: true }, () =>
      vi.advanceTimersByTimeAsync(SETTLED_AFTER_MS),
    );
    expect(
      vi.getTimerCount(),
      `timer(s) still pending ${String(SETTLED_AFTER_MS)}ms after the form unmounted`,
    ).toBe(0);
  } finally {
    clock.moving = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

/**
A runner at the keyboard, whose pauses are spent on this file's clock.
*/
function setupUser(options: Parameters<typeof userEvent.setup>[0] = {}) {
  const by = clock.owner;
  return userEvent.setup({
    ...options,
    advanceTimers: async (ms) => {
      if (!by.isOpen) await never();
      vi.advanceTimersByTime(ms);
    },
  });
}

/**
Moves this file's clock, and lets everything that was waiting on it land.
*/
async function elapse(ms: number): Promise<void> {
  await move(clock.owner, () => vi.advanceTimersByTimeAsync(ms));
}

/**
How long A1 waits between asks, read from its own policy.
*/
const POLL_MS = importPollIntervalMs(undefined, 0);

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
    // Round 25: before a file, the well keeps the primary column's measure
    // at the desk, and nothing sits beside it.
    expect(
      well().closest(`.${CSS.escape("desk:max-w-column")}`),
    ).not.toBeNull();
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
    const user = setupUser({ applyAccept: false });
    const upload = vi.fn<Upload>();
    await renderWithRouter(form({ upload }));

    await user.upload(dropInput(), file);

    expect(screen.getByText(sentence)).toBeVisible();
    expect(well()).toHaveAttribute("data-state", "error");
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses a file over the cap by its size", async () => {
    const user = setupUser();
    await renderWithRouter(form());

    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "long.gpx");
    await user.upload(dropInput(), big);

    expect(screen.getByText("That file is larger than 25 MB.")).toBeVisible();
  });

  it("clears the mark when a good file follows", async () => {
    const user = setupUser({ applyAccept: false });
    await renderWithRouter(form({ getOutcome: neverAnswers }));

    await user.upload(dropInput(), new File(["x"], "run.csv"));
    await user.upload(dropInput(), gpx());

    expect(screen.queryByText("That's not a GPX, TCX or FIT file.")).toBeNull();
  });

  it("does nothing when the picker is dismissed", async () => {
    const user = setupUser();
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
    const user = setupUser({ applyAccept: false });
    const pending = Promise.withResolvers<{ importId: string }>();
    await renderWithRouter(form({ upload: () => pending.promise }));

    await user.upload(dropInput(), new File(["x"], "run.csv"));
    await user.upload(dropInput(), gpx("good.gpx"));

    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(screen.queryByText("That's not a GPX, TCX or FIT file.")).toBeNull();
    pending.resolve({ importId: "01IMPORT" });
  });

  it("drops a failed send's band when a refused file follows it", async () => {
    const user = setupUser({ applyAccept: false });
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
    const user = setupUser({ applyAccept: false });
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
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
    const upload = vi.fn<Upload>(() =>
      Promise.resolve({ importId: "01IMPORT" }),
    );
    const getOutcome = vi.fn<GetOutcome>(() => Promise.resolve(outcome()));
    await renderWithRouter(form({ upload, getOutcome }));

    await user.upload(dropInput(), gpx());
    await waitFor(() => {
      expect(well()).toHaveAttribute("data-state", "uploading");
    });
    await firstPoll(getOutcome);
    await elapse(19_000);
    expect(
      screen.queryByText("Our end is slow. Your file is fine."),
    ).toBeNull();

    await elapse(1000);

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
    await renderWithRouter(form({}));

    await elapse(25_000);

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
    //
    // That drain only sees real timers, and this file's are fake, so every
    // test here ends with the same count taken in fake time (`afterEach`).
    // This one is the case it exists for, taken mid-read: the watch is what
    // starts the stall timer and the query whose last observer leaving
    // would schedule the collection, so the first poll is the moment both
    // can exist. Before it there is nothing to leak.
    const getOutcome = vi.fn<GetOutcome>(() => Promise.resolve(outcome()));
    await renderWithRouter(form({ getOutcome }));
    fireEvent.change(dropInput(), { target: { files: [gpx()] } });
    await firstPoll(getOutcome);
    await elapse(0);
    // The stall timer, at least: the count below is not zero by default.
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    cleanup();
    // Whatever unmounting itself queued for now — react-query batches its
    // notifications on a zero-delay timer — runs; a timer set for later
    // does not, and is what this counts.
    await elapse(0);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives a retried import twenty seconds of its own before calling it slow again", async () => {
    // The retry comes back to the same import (same key), so the stall has
    // to be reset by the send, not by a new import id.
    const user = setupUser();
    const upload = vi.fn<Upload>(() =>
      Promise.resolve({ importId: "01IMPORT" }),
    );
    const getOutcome = vi.fn<GetOutcome>(neverAnswers);
    await renderWithRouter(form({ upload, getOutcome }));
    await user.upload(dropInput(), gpx());
    await firstPoll(getOutcome);
    await elapse(20_000);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    // The resend lands, and the import is watched again, before time moves.
    // Waiting for "uploading" alone was not that: the well says so while
    // the file is still being sent, before the new watch has a stall timer
    // at all, and twenty seconds advanced from there never reached it.
    await elapse(0);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(
      screen.queryByText("Our end is slow. Your file is fine."),
    ).toBeNull();

    await elapse(20_000);
    expect(
      screen.getByText("Our end is slow. Your file is fine."),
    ).toBeVisible();
  });

  it("counts failed polls against the budget, so a dead endpoint is not asked forever", async () => {
    const getOutcome = vi
      .fn<GetOutcome>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const user = setupUser();
    await renderWithRouter(form({ getOutcome }));
    await user.upload(dropInput(), gpx());
    await firstPoll(getOutcome);

    await elapse(60 * 60 * 1000);
    const asked = getOutcome.mock.calls.length;
    await elapse(60 * 60 * 1000);

    // More than the first poll: it kept asking, then the budget stopped it.
    expect(asked).toBeGreaterThan(1);
    expect(getOutcome.mock.calls).toHaveLength(asked);
  });

  it("keeps asking after a poll that failed, and lands the card when the answer comes", async () => {
    // A first poll that errors leaves no answer at all, which used to read
    // as settled and stop the polling for good.
    const getOutcome = vi
      .fn<GetOutcome>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(outcome({ status: "done", run: runSummary() }));
    const user = setupUser();
    await renderWithRouter(form({ getOutcome }));
    await user.upload(dropInput(), gpx());
    await firstPoll(getOutcome);

    await elapse(15_000);

    expect(screen.getByText("Parsed · run.gpx")).toBeVisible();
    expect(getOutcome.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("clears a failed send's band as soon as the next file starts", async () => {
    const user = setupUser();
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
    const user = setupUser();
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
    // Two imports, one client: the form's cache outlives the first watch,
    // so what keeps the second from being served the first one's settled
    // answer is that each import is its own entry. The check is made once
    // the second import is being asked about — before that the well is
    // still sending, and shows the right file whatever the cache holds.
    const user = setupUser();
    const upload = vi
      .fn<Upload>()
      .mockResolvedValueOnce({ importId: "01IMPORT" })
      .mockResolvedValueOnce({ importId: "02IMPORT" });
    const answers = parsed();
    const getOutcome = vi.fn<GetOutcome>(({ data }) =>
      data.importId === "01IMPORT" ? answers() : neverAnswers(),
    );
    await renderWithRouter(form({ upload, getOutcome }));
    await user.upload(dropInput(), gpx());
    await screen.findByText("Parsed · run.gpx");
    await user.click(screen.getByRole("button", { name: "Replace" }));

    await user.upload(dropInput(), gpx("second.gpx"));
    await waitFor(() => {
      expect(getOutcome).toHaveBeenCalledWith({
        data: { importId: "02IMPORT" },
      });
    });
    await elapse(0);

    expect(within(well()).getByText("Reading second.gpx")).toBeVisible();
    expect(document.querySelector("[data-slot='parsed-card']")).toBeNull();
  });

  it("keeps reading while the row says so, even once it names its run", async () => {
    const user = setupUser();
    const getOutcome = vi.fn<GetOutcome>(() =>
      Promise.resolve(outcome({ status: "pending", run: runSummary() })),
    );
    await renderWithRouter(form({ getOutcome }));

    await user.upload(dropInput(), gpx());
    await firstPoll(getOutcome);
    // A whole poll: the first answer rendered, however it renders, and
    // the next one asked for.
    await elapse(POLL_MS);

    expect(getOutcome.mock.calls.length).toBeGreaterThan(1);
    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(document.querySelector("[data-slot='parsed-card']")).toBeNull();
  });
});

describe("A1: a file that would not parse", () => {
  it("names the file when it had no track in it", async () => {
    const user = setupUser();
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
    const user = setupUser();
    await renderWithRouter(
      form({
        getOutcome: () => Promise.resolve(outcome({ status: "failed" })),
      }),
    );

    await user.upload(dropInput(), gpx());

    expect(await screen.findByText(PARSE_FAILURE_MESSAGE)).toBeVisible();
  });

  it("takes another file straight from the marked well", async () => {
    const user = setupUser();
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
    const user = setupUser();
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
        name: "Change start time, 6:04 AM",
      }),
    ).toHaveTextContent("6:04 AM");
    expect(document.querySelector("[data-part='drop-zone']")).toBeNull();

    // The conditions block, read-only, with the correction's note.
    const conditions = document.querySelector("[data-slot='conditions']");
    expect(conditions).toHaveTextContent("Conditions · auto-attached");
    expect(conditions).toHaveTextContent("41°F");
    expect(conditions).toHaveTextContent(
      "Never typed by hand. Wrong time? Change it on the run card and we’ll get the weather for it.",
    );
    expect(conditions?.querySelector("input")).toBeNull();

    const next = screen.getByRole("link", {
      name: "Looks right — what did you wear?",
    });
    expect(next).toHaveAttribute("href", `/feed/attach/${RUN_ID}`);
    expect(router.state.location.pathname).toBe("/");
  });

  it("breathes in the conditions' place while the weather is asked for, then shows it", async () => {
    const user = setupUser();
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
    expect(screen.queryByText("Conditions · auto-attached")).toBeNull();

    // The next poll brings the weather.
    await elapse(POLL_MS);

    expect(screen.getByText("Conditions · auto-attached")).toBeVisible();
  });

  it("says so when the weather never came, and offers nothing to type", async () => {
    const user = setupUser();
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
    const user = setupUser();
    await renderWithRouter(form({ getOutcome: parsed() }));
    await user.upload(dropInput(), gpx());
    await screen.findByText("Parsed · run.gpx");

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(well()).toHaveAttribute("data-state", "empty");
    expect(document.querySelector("[data-slot='parsed-card']")).toBeNull();
  });

  it("opens the START TIME row in the time's place, with the hint and focus on the field", async () => {
    const user = setupUser();
    await renderWithRouter(form({ getOutcome: parsed() }));
    await user.upload(dropInput(), gpx());

    await user.click(
      await screen.findByRole("button", { name: "Change start time, 6:04 AM" }),
    );

    // The row replaces the time on the stats line; the date stays.
    const card = region("parsed-card");
    expect(
      within(card).queryByRole("button", { name: /Change start time/u }),
    ).toBeNull();
    expect(within(card).getByText("Sat Aug 29")).toBeVisible();
    expect(within(card).getByText("8:20 /mi").closest("p")).toHaveTextContent(
      /^8:20 \/mi\|Sat Aug 29$/u,
    );
    const field = within(card).getByLabelText("Start time");
    // The run's own clock: 6:04 in Chicago, not 11:04 UTC.
    expect(field).toHaveValue("06:04");
    expect(field).toHaveFocus();
    expect(
      within(card).getByText(
        "The file said 6:04 AM. Change it if your watch's clock was off.",
      ),
    ).toBeVisible();
    expect(
      within(card).getByRole("button", { name: "Get weather" }),
    ).toBeVisible();
  });

  it("moves the start on the run's own clock, and says CHANGED when the weather comes", async () => {
    const user = setupUser();
    const retime = vi.fn<Retime>(() => Promise.resolve("moved"));
    const getOutcome = vi.fn<GetOutcome>(parsed());
    await renderWithRouter(form({ getOutcome, retime }));
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: "Change start time, 6:04 AM" }),
    );
    const asked = getOutcome.mock.calls.length;

    const field = screen.getByLabelText("Start time");
    await user.clear(field);
    await user.type(field, "07:34");
    await user.click(screen.getByRole("button", { name: "Get weather" }));

    await waitFor(() => {
      expect(retime).toHaveBeenCalledWith({
        data: {
          runId: RUN_ID,
          startedAt: SAT_MORNING + 90 * 60,
          timeZone: "America/Chicago",
        },
      });
    });
    const changed = await screen.findByRole("button", {
      name: "Change start time, 7:34 AM",
    });
    expect(changed).toHaveTextContent("7:34 AM · Changed");
    expect(screen.queryByLabelText("Start time")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Start time changed to 7:34 AM.",
    );
    // The run is asked for again, so the block fills in for the new hour.
    expect(getOutcome.mock.calls.length).toBeGreaterThan(asked);
  });

  it("says what it is getting, and what it was, while the weather is fetched", async () => {
    const user = setupUser();
    const pending = Promise.withResolvers<"moved">();
    const retime = vi.fn<Retime>(() => pending.promise);
    await renderWithRouter(form({ getOutcome: parsed(), retime }));
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: "Change start time, 6:04 AM" }),
    );
    const field = screen.getByLabelText("Start time");
    await user.clear(field);
    await user.type(field, "06:34");
    await user.click(screen.getByRole("button", { name: "Get weather" }));

    const block = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        "[data-slot='conditions'][data-state='fetching']",
      );
      if (found === null) throw new Error("not fetching yet");
      return found;
    });
    expect(block).toHaveTextContent("Weather for 6:34 AM");
    expect(block).toHaveTextContent("[Getting it]");
    expect(block).toHaveTextContent("Was 41°F damp · feels 36° · at 6:04 AM");
    // The block is read-only, and at the desk it is the rail.
    expect(block.closest("[data-part='rail']")).not.toBeNull();
    expectBusy(screen.getByRole("button", { name: "Getting" }));

    pending.resolve("moved");
    await waitFor(() => {
      expect(document.querySelector("[data-state='fetching']")).toBeNull();
    });
  });

  it("says STILL the old time, and offers the same time again, when there is no weather for the new one", async () => {
    const user = setupUser();
    const retime = vi
      .fn<Retime>()
      .mockResolvedValueOnce("no-weather")
      .mockResolvedValueOnce("moved");
    await renderWithRouter(form({ getOutcome: parsed(), retime }));
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: "Change start time, 6:04 AM" }),
    );
    const field = screen.getByLabelText("Start time");
    await user.clear(field);
    await user.type(field, "07:34");
    await user.click(screen.getByRole("button", { name: "Get weather" }));

    const band = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        "[data-part='failure-band']",
      );
      if (found === null) throw new Error("no band yet");
      return found;
    });
    // A control, so never in the read-only rail (round 25).
    expect(band.closest("[data-part='rail']")).toBeNull();
    expect(band).toHaveTextContent("Still 6:04 AM");
    expect(band).toHaveTextContent(
      "Couldn't get weather for 7:34 AM. Try again?",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Still 6:04 AM. Couldn't get weather for 7:34 AM. Try again?",
    );
    // The time did not move: the server put it back.
    expect(screen.getByLabelText("Start time")).toBeVisible();

    await user.click(within(band).getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(retime).toHaveBeenCalledTimes(2);
    });
    const sent = retime.mock.calls.map((call) => call[0].data.startedAt);
    expect(sent).toStrictEqual([SAT_MORNING + 90 * 60, SAT_MORNING + 90 * 60]);
    await waitFor(() => {
      expect(document.querySelector("[data-part='failure-band']")).toBeNull();
    });
  });

  it("asks for a time when the field is emptied, in the schema's words", async () => {
    const user = setupUser();
    const retime = vi.fn<Retime>(() => Promise.resolve("moved"));
    await renderWithRouter(form({ getOutcome: parsed(), retime }));
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: "Change start time, 6:04 AM" }),
    );

    await user.clear(screen.getByLabelText("Start time"));
    await user.click(screen.getByRole("button", { name: "Get weather" }));

    expect(
      await screen.findByText("Pick the time the run started."),
    ).toBeVisible();
    expect(screen.getByLabelText("Start time")).toHaveAccessibleDescription(
      "Pick the time the run started.",
    );
    expect(retime).not.toHaveBeenCalled();
  });

  it("treats a refused correction as a failure: nothing changed", async () => {
    const user = setupUser();
    const retime = vi.fn<Retime>(() => Promise.resolve("refused"));
    await renderWithRouter(form({ getOutcome: parsed(), retime }));
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: "Change start time, 6:04 AM" }),
    );

    await user.click(screen.getByRole("button", { name: "Get weather" }));

    expect(await screen.findByText("Nothing saved")).toBeVisible();
    expect(screen.getByLabelText("Start time")).toBeVisible();
  });

  it("keeps the page where it is when the time is sent", async () => {
    const user = setupUser();
    const submitted: SubmitEvent[] = [];
    const onSubmit = (event: SubmitEvent) => {
      submitted.push(event);
    };
    document.addEventListener("submit", onSubmit);
    try {
      await renderWithRouter(form({ getOutcome: parsed() }));
      await user.upload(dropInput(), gpx());
      await user.click(
        await screen.findByRole("button", {
          name: "Change start time, 6:04 AM",
        }),
      );

      await user.click(screen.getByRole("button", { name: "Get weather" }));

      expect(
        await screen.findByText("Start time changed to 6:04 AM."),
      ).toBeInTheDocument();
      expect(submitted.map((event) => event.defaultPrevented)).toEqual([true]);
    } finally {
      document.removeEventListener("submit", onSubmit);
    }
  });

  it("holds the primary action in brackets while the weather is fetched, then goes", async () => {
    const user = setupUser();
    const pending = Promise.withResolvers<"moved">();
    const retime = vi.fn<Retime>(() => pending.promise);
    const { router } = await renderWithRouter(
      form({ getOutcome: parsed(), retime }),
    );
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: "Change start time, 6:04 AM" }),
    );
    await user.click(screen.getByRole("button", { name: "Get weather" }));
    await waitFor(() => {
      expectBusy(screen.getByRole("button", { name: "Getting" }));
    });

    const next = screen.getByRole("button", {
      name: "Looks right — what did you wear?",
    });
    await user.click(next);

    // Waiting, not gone, and never disabled.
    expect(router.state.location.pathname).toBe("/");
    expect(next).toHaveTextContent("[Looks right — what did you wear?]");
    expect(next).not.toHaveAttribute("aria-disabled");
    expect(next).toHaveClass("bg-action", "target");

    pending.resolve("moved");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/feed/attach/${RUN_ID}`);
    });
  });

  it("goes straight away, as a plain link, when nothing is being fetched", async () => {
    const user = setupUser();
    const { router } = await renderWithRouter(form({ getOutcome: parsed() }));
    await user.upload(dropInput(), gpx());
    const next = await screen.findByRole("link", {
      name: "Looks right — what did you wear?",
    });
    // The log verb's pink, as a 44px target.
    expect(next).toHaveClass("bg-action", "target");

    await user.click(next);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/feed/attach/${RUN_ID}`);
    });
  });

  it("says there was no weather before, when the run had none", async () => {
    const user = setupUser();
    const pending = Promise.withResolvers<"moved">();
    await renderWithRouter(
      form({
        getOutcome: parsed({ weatherStatus: "failed", conditions: undefined }),
        retime: () => pending.promise,
      }),
    );
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: /Change start time/u }),
    );
    await user.click(screen.getByRole("button", { name: "Get weather" }));

    const block = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        "[data-state='fetching']",
      );
      if (found === null) throw new Error("not fetching yet");
      return found;
    });
    expect(block).toHaveTextContent(/Was no weather · at /u);
    pending.resolve("moved");
  });

  it("announces only the answer, never a sentence of its own first", async () => {
    const user = setupUser();
    await renderWithRouter(form({ getOutcome: parsed() }));
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: "Change start time, 6:04 AM" }),
    );
    const status = screen.getByRole("status");
    const said: string[] = [];
    const observer = new MutationObserver(() => {
      said.push(status.textContent);
    });
    observer.observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    await user.click(screen.getByRole("button", { name: "Get weather" }));
    await screen.findByText("Start time changed to 6:04 AM.");
    observer.disconnect();

    expect(said.filter((text) => text !== "")).toStrictEqual([
      "Start time changed to 6:04 AM.",
    ]);
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
    const user = setupUser();
    const retime = vi.fn<Retime>(() => Promise.resolve("moved"));
    await renderWithRouter(
      form({
        getOutcome: parsed({ weatherStatus: "failed", conditions: undefined }),
        retime,
      }),
    );
    await user.upload(dropInput(), gpx());

    const time = await screen.findByRole("button", {
      name: "Change start time, 4:04 AM",
    });
    expect(time).toHaveTextContent("4:04 AM");
    await user.click(time);
    const field = screen.getByLabelText("Start time");
    expect(field).toHaveValue("04:04");
    await user.clear(field);
    await user.type(field, "05:04");
    await user.click(screen.getByRole("button", { name: "Get weather" }));

    await waitFor(() => {
      expect(retime).toHaveBeenCalledWith({
        data: {
          runId: RUN_ID,
          startedAt: SAT_MORNING + 3600,
          timeZone: "America/Los_Angeles",
        },
      });
    });
  });

  it("sends the same start when the correction is tried again", async () => {
    // A response lost on the way back: the retry must not move the run a
    // second time, which a relative shift did.
    const user = setupUser();
    const retime = vi
      .fn<Retime>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("moved");
    await renderWithRouter(form({ getOutcome: parsed(), retime }));
    await user.upload(dropInput(), gpx());
    await user.click(
      await screen.findByRole("button", { name: "Change start time, 6:04 AM" }),
    );
    const field = screen.getByLabelText("Start time");
    await user.clear(field);
    await user.type(field, "07:34");
    await user.click(screen.getByRole("button", { name: "Get weather" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(retime).toHaveBeenCalledTimes(2);
    });
    const sent = retime.mock.calls.map((call) => call[0].data.startedAt);
    expect(sent).toStrictEqual([SAT_MORNING + 90 * 60, SAT_MORNING + 90 * 60]);
  });

  it("splits the facts with a rule between each, never before the first", async () => {
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
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
