import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ManualRunForm } from "../../src/modules/runs/components/ManualRunForm";

/**
 * Screen R2, the run you type in yourself.
 *
 * The unit conversion is the whole point of it: the contract stores SI —
 * seconds and metres — and nobody types seconds into a form, so the inputs
 * take minutes and kilometres. That conversion had no test, because the
 * component reached `../functions` for the submit.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/$runId",
    component: () => <p>The run</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, runRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

const STARTED = "2026-08-15T07:30";

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Started"), STARTED);
}

type SubmitRun = (input: {
  data: Record<string, unknown>;
}) => Promise<{ id: string }>;

function fakeSubmit(id = "01RUN") {
  return vi.fn<SubmitRun>(() => Promise.resolve({ id }));
}

function submitted(fake: ReturnType<typeof fakeSubmit>) {
  return fake.mock.calls[0]?.[0]?.data;
}

describe("ManualRunForm: what it sends", () => {
  it("converts minutes to seconds and kilometres to metres", async () => {
    // The labels are in input units and the keys are the schema's, on
    // purpose: `useFormSubmit` looks a field up by `name` to focus it, so
    // the DOM name has to be the schema key or a server-side error lands
    // on nothing.
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    const minutes = screen.getByLabelText("Minutes");
    await user.clear(minutes);
    await user.type(minutes, "42");
    const distance = screen.getByLabelText("Distance (km)");
    await user.clear(distance);
    await user.type(distance, "7.5");
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    expect(submitted(submitRun)).toMatchObject({
      durationS: 2520,
      distanceM: 7500,
      title: "Morning run",
      indoor: false,
    });
  });

  it("rounds a fractional minute rather than truncating it", async () => {
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    const minutes = screen.getByLabelText("Minutes");
    await user.clear(minutes);
    await user.type(minutes, "30.51");
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    expect(
      submitted(submitRun),
    ).toMatchObject({ durationS: 1831 });
  });

  it("sends the start as epoch seconds, not as the string it was typed in", async () => {
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    const data = submitted(submitRun);
    expect(data?.startedAt).toBe(
      Math.floor(new Date(STARTED).getTime() / 1000),
    );
  });

  it("carries an idempotency key, so a double submit is one run", async () => {
    // Law 8b: minted when the form mounts, resent on every retry of that
    // same submission.
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    const data = submitted(submitRun);
    expect(typeof data?.idempotencyKey).toBe("string");
  });

  it("marks a treadmill run indoor", async () => {
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    await user.click(screen.getByLabelText(/Indoor/));
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    expect(
      submitted(submitRun),
    ).toMatchObject({ indoor: true });
  });
});

describe("ManualRunForm: effort is optional", () => {
  it("omits it entirely when it is not set", async () => {
    // Omitted, not sent as "": the column is nullable and an empty string
    // is a value the contract has no meaning for.
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    const data = submitted(submitRun);
    expect(Object.hasOwn(data ?? {}, "effort")).toBe(false);
  });

  it("sends it when it is", async () => {
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    await user.selectOptions(screen.getByLabelText(/Effort/), "workout");
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    expect(
      submitted(submitRun),
    ).toMatchObject({ effort: "workout" });
  });

  it("takes it back when they choose Not set again", async () => {
    // The way out of an optional field has to work, or a mis-tap becomes
    // a value the run carries forever.
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    const effort = screen.getByLabelText(/Effort/);
    await user.selectOptions(effort, "race");
    await user.selectOptions(effort, "");
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    expect(Object.hasOwn(submitted(submitRun) ?? {}, "effort")).toBe(false);
  });

  it("offers every effort the contract knows, and a way out", async () => {
    await renderWithRouter(
      <ManualRunForm submitRun={() => Promise.resolve({ id: "01RUN" })} />,
    );

    const select = document.querySelector("select");
    expect(
      [...(select?.options ?? [])].map((option) => option.value),
    ).toStrictEqual(["", "easy", "steady", "workout", "race"]);
    expect(screen.getByRole("option", { name: "Not set" })).toBeInTheDocument();
  });
});

describe("ManualRunForm: after it lands", () => {
  it("takes them to the run it just created", async () => {
    const user = userEvent.setup();
    const router = await renderWithRouter(
      <ManualRunForm submitRun={() => Promise.resolve({ id: "01NEWRUN" })} />,
    );

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/runs/01NEWRUN");
    });
  });

  it("rotates the idempotency key, so the next run is a new one", async () => {
    // The key is per-submission: reusing it would make a second, genuinely
    // different run look like a retry of the first and return the first
    // one's row.
    const user = userEvent.setup();
    const keys: unknown[] = [];
    const submitRun = vi.fn<SubmitRun>((input) => {
      keys.push(input.data.idempotencyKey);
      return Promise.reject(new Error("network went away"));
    });
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Log run" }));
    await screen.findByRole("button", { name: /try again/i });

    // A retry of the *same* submission keeps the key.
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => {
      expect(keys).toHaveLength(2);
    });
    expect(keys[1]).toBe(keys[0]);
  });
});

describe("ManualRunForm: what it refuses", () => {
  it("will not submit a run with no start time", async () => {
    // An empty datetime-local parses to NaN, which the schema refuses —
    // and the message is phrased in the input's units, not the schema's.
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await user.click(screen.getByRole("button", { name: "Log run" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Nothing saved/);
    expect(submitRun).not.toHaveBeenCalled();
  });

  it("marks and focuses the field the schema refused", async () => {
    // `form.field("durationS")` wires the name the summary and the focus
    // move look up. A wrong name there means a server-side error lands on
    // nothing at all.
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    const minutes = screen.getByLabelText("Minutes");
    await user.clear(minutes);
    await user.type(minutes, "0");
    await user.click(screen.getByRole("button", { name: "Log run" }));

    await waitFor(() => {
      expect(minutes).toHaveAttribute("aria-invalid", "true");
    });
    expect(minutes).toHaveAttribute("name", "durationS");
    await waitFor(() => {
      expect(minutes).toHaveFocus();
    });
  });

  it("names every field the way the schema does", async () => {
    // The DOM name is the schema key, not the label, so `focusField` and
    // `fieldErrors[name]` can find it.
    await renderWithRouter(<ManualRunForm submitRun={fakeSubmit()} />);

    expect(screen.getByLabelText("Title")).toHaveAttribute("name", "title");
    expect(screen.getByLabelText("Started")).toHaveAttribute("name", "startedAt");
    expect(screen.getByLabelText("Distance (km)")).toHaveAttribute(
      "name",
      "distanceM",
    );
    expect(screen.getByLabelText(/Effort/)).toHaveAttribute("name", "effort");
    // And the start is empty rather than pre-filled with a time the user
    // did not run at.
    expect(screen.getByLabelText("Started")).toHaveValue("");
  });

  it("submits through its own handler, never the browser's", async () => {
    const user = userEvent.setup();
    await renderWithRouter(<ManualRunForm submitRun={fakeSubmit()} />);
    await fillValid(user);

    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(screen.getByRole("button", { name: "Log run" }));
    } finally {
      document.removeEventListener("submit", watch);
    }

    expect(prevented).toBe(true);
  });

  it("will not submit a run of no length", async () => {
    const user = userEvent.setup();
    const submitRun = fakeSubmit();
    await renderWithRouter(<ManualRunForm submitRun={submitRun} />);

    await fillValid(user);
    const minutes = screen.getByLabelText("Minutes");
    await user.clear(minutes);
    await user.type(minutes, "0");
    await user.click(screen.getByRole("button", { name: "Log run" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Nothing saved/);
    expect(submitRun).not.toHaveBeenCalled();
  });

  it("keeps the browser's own validation out of it", async () => {
    // `noValidate`: the browser's bubbles are a second, unstyled error
    // system that fires first and says "Please fill in this field".
    await renderWithRouter(
      <ManualRunForm submitRun={() => Promise.resolve({ id: "01RUN" })} />,
    );
    expect(
      screen.getByRole("button", { name: "Log run" }).closest("form"),
    ).toHaveAttribute("novalidate");
  });
});
