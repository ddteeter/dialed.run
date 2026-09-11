import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  FormErrorSummary,
  FormFailureBand,
  FormField,
  FormStatus,
  SubmitButton,
  TextField,
} from "../../src/ui/form";
import { DURATION } from "../../src/ui/motion";
import { useFormSubmit } from "../../src/ui/use-form-submit";

/**
 * The Forms & failure contract, driven rather than rendered.
 *
 * `test/ui/form.test.tsx` renders these primitives to a string in the
 * workers pool, which is first paint and nothing after it. Every rule the
 * contract actually turns on — that the submit button is never `disabled`,
 * that a second click cannot start a second submit, that a field error
 * clears on input and not on blur, that nothing in the failure path
 * animates — is a statement about the DOM *after* an interaction, and had
 * no test that could reach it.
 *
 * These run in jsdom (the `ui` project in vitest.config.ts) for that
 * reason, and drive the real `useFormSubmit` rather than a stand-in: the
 * contract lives in the hook, so a fake would be testing this file.
 */

const schema = z.object({
  name: z.string().min(1, "Give it a name."),
  brand: z.string().min(1, "Which brand?"),
});

function Harness({
  action,
  onSuccess,
  withLabels = true,
}: Readonly<{
  action: (values: z.output<typeof schema>) => Promise<unknown>;
  onSuccess?: (() => void) | undefined;
  /**
   * `labels` is optional on the hook; without it a row is named by its key.
   */
  withLabels?: boolean;
}>) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const form = useFormSubmit({
    schema,
    action,
    successMessage: "Saved.",
    ...(withLabels && { labels: { name: "Name", brand: "Brand" } }),
    ...(onSuccess !== undefined && { onSuccess }),
  });

  return (
    <form
      ref={form.formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({ name, brand });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />
      <TextField
        name="name"
        label="Name"
        value={name}
        onChange={setName}
        field={form.field}
        error={form.fieldErrors.name}
        hint="As it appears on the label."
      />
      <TextField
        name="brand"
        label="Brand"
        value={brand}
        onChange={setBrand}
        field={form.field}
        error={form.fieldErrors.brand}
      />
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton label="Save" pendingLabel="Saving" pending={form.pending} />
    </form>
  );
}

function deferred<T>() {
  return Promise.withResolvers<T>();
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Houdini");
  await user.type(screen.getByLabelText("Brand"), "Patagonia");
}

/**
 * Rejects with `reason` exactly as given, never wrapped in an Error.
 *
 * `throw reason` rather than `Promise.reject(reason)`: `reason` stays typed
 * `unknown` at the throw site, which `only-throw-error` allows by default —
 * `prefer-promise-reject-errors` does not extend the same allowance to
 * `Promise.reject`, and wrapping in an Error would misrepresent what these
 * tests are proving (below).
 *
 * Not `async`: the function never reaches a `return`, so its real type is
 * `never` — a synchronous throw during `action(pre.data)`'s evaluation
 * lands in `submit`'s own `try/catch` exactly as an awaited rejection
 * would, and `never` is assignable wherever the harness expects
 * `Promise<unknown>`. Marking it `async` bought nothing but an
 * `require-await` violation.
 */
function rejectWith(reason: unknown): never {
  throw reason;
}

/**
 * A rejection from a server function has crossed a structured clone, so
 * it is a plain object with no prototype — `instanceof ZodError` is
 * false for a real one. The hook therefore *parses* what came back
 * rather than casting it, and these are the cases that parse decides.
 *
 * Getting it wrong in either direction is silent: a real field error
 * classified as a server failure marks the button instead of the field,
 * and a malformed payload treated as issues marks fields that may not
 * exist while claiming the fix is inside the form.
 */
async function submitAndReject(reason: unknown) {
  const user = userEvent.setup();
  render(<Harness action={() => rejectWith(reason)} />);
  await fillValid(user);
  await user.click(screen.getByRole("button", { name: /save/i }));
}

describe("the submit button is never disabled", () => {
  it("marks itself busy with aria, and keeps focus and its accessible name", async () => {
    // §5, the one most easily lost in a port: `disabled` drops focus and
    // stops announcing, so a screen reader user loses their place at the
    // exact moment the app has something to say.
    const user = userEvent.setup();
    const pending = deferred<undefined>();
    render(<Harness action={() => pending.promise} />);

    await fillValid(user);
    const button = screen.getByRole("button", { name: /save/i });
    await user.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    // Still reachable, still named — the two things `disabled` takes away.
    expect(button).toHaveFocus();
    // Pink is action, and the submit button is the action. The cursor is
    // the visual half of aria-disabled: it must stop inviting a click.
    expect(button).toHaveClass("bg-pink");
    expect(button).toHaveClass("cursor-default");
    expect(button).not.toHaveClass("cursor-pointer");

    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });
});

describe("the double-submit guard", () => {
  it("starts one submit however many times the button is clicked", async () => {
    // Law 8b's client half. The guard is a ref in the handler, not the
    // button's disabled state, and this is the only place that can tell.
    const user = userEvent.setup();
    const pending = deferred<undefined>();
    const action = vi.fn(() => pending.promise);
    render(<Harness action={action} />);

    await fillValid(user);
    const button = screen.getByRole("button", { name: /save/i });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(action).toHaveBeenCalledTimes(1);

    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });

  it("accepts a second submit once the first has finished", async () => {
    // The guard is per-submission, not a latch: a user who fixes something
    // and submits again must not be silently ignored.
    const user = userEvent.setup();
    const action = vi.fn(() => Promise.resolve());
    render(<Harness action={action} />);

    await fillValid(user);
    const button = screen.getByRole("button", { name: /save/i });
    await user.click(button);
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    await user.click(button);

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(2);
    });
  });
});

describe("a field error is announced, then focused", () => {
  it("focuses the one bad field and describes it, without calling the action", async () => {
    const user = userEvent.setup();
    const action = vi.fn(() => Promise.resolve());
    render(<Harness action={action} />);

    await user.type(screen.getByLabelText("Brand"), "Patagonia");
    await user.click(screen.getByRole("button", { name: /save/i }));

    // Announce, then move: the live region carries the sentence, and the
    // field is described by its message rather than reddened.
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nothing saved. One field needs a fix.",
    );
    const name = screen.getByLabelText("Name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Give it a name.");
    await waitFor(() => {
      expect(name).toHaveFocus();
    });
    expect(action).not.toHaveBeenCalled();
  });

  it("summarises two or more, and focuses the summary instead", async () => {
    // A summary listing one row is a step between the user and the fix, so
    // it only appears at two.
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve()} />);

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nothing saved. 2 fields need a fix.",
    );
    const summary = screen.getByText("Nothing saved").parentElement;
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
    expect(
      screen.getByRole("button", { name: /Name/ }),
    ).toBeVisible();
  });

  it("clears on input, not on blur, and does not re-validate while typing", async () => {
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve()} />);

    // One error, so focus lands on the field itself — leaving both empty
    // focuses the summary instead, and then nothing ever blurs the field
    // and this test passes without testing anything.
    await user.type(screen.getByLabelText("Brand"), "Patagonia");
    await user.click(screen.getByRole("button", { name: /save/i }));
    const name = await screen.findByLabelText("Name");
    await waitFor(() => {
      expect(name).toHaveFocus();
    });
    expect(name).toHaveAttribute("aria-invalid", "true");

    // Blur alone leaves it marked — the error is not re-evaluated on every
    // exit from the field.
    await user.tab();
    expect(name).not.toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");

    await user.type(name, "H");
    expect(name).not.toHaveAttribute("aria-invalid");
  });
});

describe("the mark, the message and the hint", () => {
  it("marks by border weight and a band, never by hue alone", async () => {
    // Pink is action in this palette and never failure. The signal is a
    // 1px rule going to 2px ink plus a hi-viz band — so the assertion is
    // on the marked state, not on a colour.
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve()} />);

    const box = () => screen.getByLabelText("Name").parentElement;
    expect(box).not.toBeNull();
    expect(box()).not.toHaveAttribute("data-invalid");
    // Weight is the signal: a 1px rule at rest, 2px ink when marked, and
    // the padding drops by 1px so the box does not grow. Asserted because
    // "marked, not reddened" is the rule most easily lost in a port, and
    // because pink is action in this palette and never failure.
    expect(box()).toHaveClass("border");
    expect(box()).not.toHaveClass("border-2");

    await user.type(screen.getByLabelText("Brand"), "Patagonia");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(box()).toHaveAttribute("data-invalid", "true");
    });
    expect(box()).toHaveClass("border-2");
    expect(screen.getByText("Give it a name.")).toBeVisible();
  });

  it("drops the hint while the field is invalid, and brings it back", async () => {
    // The hint and the message never sit together: two sentences under one
    // control is one too many, and the message is the one that matters.
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve()} />);

    expect(screen.getByText("As it appears on the label.")).toBeVisible();

    await user.type(screen.getByLabelText("Brand"), "Patagonia");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText("Give it a name.")).toBeVisible();
    });
    expect(screen.queryByText("As it appears on the label.")).toBeNull();

    await user.type(screen.getByLabelText("Name"), "Houdini");
    expect(screen.getByText("As it appears on the label.")).toBeVisible();
  });
});

describe("the summary is a set of controls, not a list of links", () => {
  it("moves focus to the field a row names", async () => {
    // A form is not a document: the target is a control, not a location,
    // so the rows are buttons and pressing one lands in the field.
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve()} />);

    await user.click(screen.getByRole("button", { name: /save/i }));
    const row = await screen.findByRole("button", { name: /Brand/ });

    await user.click(row);

    await waitFor(() => {
      expect(screen.getByLabelText("Brand")).toHaveFocus();
    });
  });
});

describe("the pending state swaps the label, and keeps the box the same size", () => {
  it("shows the pending label and hides the resting one", async () => {
    // Both labels are stacked in one grid cell and swapped by visibility,
    // so the button cannot change width mid-submit. `toBeVisible` reads
    // the visibility style, which is the mechanism.
    const user = userEvent.setup();
    const pending = deferred<undefined>();
    render(<Harness action={() => pending.promise} />);

    await fillValid(user);
    expect(screen.getByText("Save")).toBeVisible();
    expect(screen.getByText("Saving")).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText("Saving")).toBeVisible();
    });
    expect(screen.getByText("Save")).not.toBeVisible();

    pending.resolve(undefined);
    await waitFor(() => {
      expect(screen.getByText("Save")).toBeVisible();
    });
  });
});

describe("the details that go missing silently", () => {
  it("gives a field with no hint nothing to say, rather than an empty line", () => {
    const { container } = render(
      <FormField name="solo" label="Solo">
        <input id="solo" name="solo" />
      </FormField>,
    );
    // Not just "no text" — no *element*. An empty <span> renders nothing
    // and still takes a line's worth of gap in a flex column, which is how
    // a field with no hint ends up taller than its neighbours.
    expect(container.querySelectorAll("span")).toHaveLength(0);
    expect(container.firstElementChild).toHaveTextContent(/^Solo$/);
  });

  it("renders the hint as one element, and the message replaces it", async () => {
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve()} />);

    // The field's own children, not the form's: the submit button stacks
    // two spans of its own and would swamp the count.
    const messages = () =>
      screen.getByLabelText("Name").closest("div")?.parentElement
        ?.querySelectorAll(":scope > span") ?? [];

    expect(messages()).toHaveLength(1);

    await user.type(screen.getByLabelText("Brand"), "Patagonia");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText("Give it a name.")).toBeVisible();
    });
    // Still one: the message took the hint's place rather than joining it.
    expect(messages()).toHaveLength(1);
  });

  it("defaults a text field to type=text", () => {
    render(
      <TextField
        name="plain"
        label="Plain"
        value=""
        onChange={() => {
          // uncontrolled for this assertion
        }}
        field={(name) => ({
          name,
          readOnly: false,
          "aria-invalid": undefined,
          "aria-describedby": undefined,
          onInput: () => {
            // nothing to clear: this field has no error state
          },
        })}
      />,
    );
    // The default is what almost every field uses, so a wrong one would be
    // wrong nearly everywhere and look right in every snapshot.
    expect(screen.getByLabelText("Plain")).toHaveAttribute("type", "text");
  });

  it("makes the summary focusable by script but not by tab", async () => {
    // `tabIndex={-1}` — focus lands there when the form sends it, and a
    // keyboard user tabbing through the form never has to pass a heading.
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve()} />);

    await user.click(screen.getByRole("button", { name: /save/i }));
    const heading = await screen.findByText("Nothing saved");
    const summary = heading.parentElement;
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
    expect(summary).toHaveAttribute("tabindex", "-1");

    // Tab moves on to the rows rather than back into the container.
    await user.tab();
    expect(summary).not.toHaveFocus();
  });

  it("carries no aria-disabled at rest", async () => {
    // `pending || undefined`, not `pending`: React renders
    // `aria-disabled="false"` for the boolean, and a button that announces
    // itself as not-disabled on every render is noise.
    const user = userEvent.setup();
    const pending = deferred<undefined>();
    render(<Harness action={() => pending.promise} />);

    const button = screen.getByRole("button", { name: /save/i });
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).toHaveClass("cursor-pointer");

    await fillValid(user);
    await user.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-disabled", "true");
    });

    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-disabled");
    });
  });
});

describe("the failure band", () => {
  it("says nothing was saved, moves focus to retry, and retries the same values", async () => {
    const user = userEvent.setup();
    const action = vi
      .fn<(values: z.output<typeof schema>) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("network went away"))
      .mockResolvedValueOnce(undefined);
    render(<Harness action={action} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));

    const retry = await screen.findByRole("button", { name: /try again/i });
    await waitFor(() => {
      expect(retry).toHaveFocus();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/^Nothing saved\./);

    await user.click(retry);
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(2);
    });
    // The same values, not an empty resubmit.
    expect(action.mock.calls[1]?.[0]).toStrictEqual(action.mock.calls[0]?.[0]);
  });

  it("carries no animation — the failure path is deliberately static", async () => {
    // The Motion Doctrine's NEVER list: "offline / error: nothing,
    // deliberately static". A shake is a spring wearing a costume.
    const user = userEvent.setup();
    render(
      <Harness action={() => Promise.reject(new Error("network went away"))} />,
    );

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));

    const retry = await screen.findByRole("button", { name: /try again/i });
    const band = retry.parentElement;
    const classes = band?.className ?? "";
    expect(classes).not.toMatch(/animate-|transition|breathe|motion-/);
  });
});

describe("announce, then move (D-44)", () => {
  it("has filled the live region before onSuccess runs", async () => {
    /**
     * The rule is *announce, then move*, and every form in the app that
     * navigates on success was breaking it: `onSuccess` typically calls
     * `navigate`, which unmounts this `role="status"` region — so the
     * success sentence was set and destroyed without a commit in between
     * and no screen reader could ever read it.
     *
     * Asserting "it was announced" from outside is impossible once the
     * region is gone, so this reads the region *at the moment `onSuccess`
     * runs*, which is exactly the ordering under test. Before the fix this
     * is the empty string.
     *
     * The failure path already did it correctly — it sets the status and
     * defers its focus move — so the fix is to give success the same
     * grace rather than invent one.
     */
    const user = userEvent.setup();
    // A flag as well as the value: "onSuccess has not run yet" and "it ran
    // and the region was empty" are the two outcomes under test, and one
    // variable cannot tell them apart.
    let didRun = false;
    let statusWhenSuccessRan = "";
    render(
      <Harness
        action={() => Promise.resolve(undefined)}
        onSuccess={() => {
          didRun = true;
          statusWhenSuccessRan = screen.getByRole("status").textContent;
        }}
      />,
    );

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(didRun).toBe(true);
    });
    expect(statusWhenSuccessRan).toBe("Saved.");
  });
});

describe("what counts as field errors coming back from a server function", () => {
  it("marks the field an issue names", async () => {
    await submitAndReject({
      issues: [{ path: ["brand"], message: "We do not stock that one." }],
    });

    expect(
      await screen.findByText("We do not stock that one."),
    ).toBeVisible();
    expect(screen.getByLabelText("Brand")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("joins a nested path with dots, so a field name is one string", async () => {
    // `issue.path.join(".")` — the key has to be the whole path, because a
    // nested field's name is `items.0.flag`, and keying on the first
    // segment alone would collapse every item's flag into one error.
    //
    // Read off the summary rather than a field message: a key with no
    // control on screen has nothing to render into, and the summary falls
    // back to the key when no label is given for it. Numbers in the path
    // are why the segment schema admits them.
    await submitAndReject({
      issues: [
        { path: ["items", 0, "flag"], message: "Pick one." },
        { path: ["items", 1, "flag"], message: "Pick another." },
      ],
    });

    expect(
      await screen.findByRole("button", { name: /items\.0\.flag/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /items\.1\.flag/ }),
    ).toBeVisible();
    // Two distinct fields, so two rows — not one key overwriting the other.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing saved. 2 fields need a fix.",
    );
  });

  it("keeps the first message per field, never a stack", async () => {
    await submitAndReject({
      issues: [
        { path: ["brand"], message: "First." },
        { path: ["brand"], message: "Second." },
      ],
    });

    expect(await screen.findByText("First.")).toBeVisible();
    expect(screen.queryByText("Second.")).toBeNull();
    // One field, not two — the count is what the announcement reads from.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing saved. One field needs a fix.",
    );
  });

  it("ignores an issue that names no field", async () => {
    // An empty path cannot mark anything, so it must not be counted as a
    // field error either — otherwise the form announces a fix that is
    // nowhere on screen.
    await submitAndReject({
      issues: [
        { path: [], message: "Nowhere." },
        { path: ["name"], message: "Somewhere." },
      ],
    });

    expect(await screen.findByText("Somewhere.")).toBeVisible();
    expect(screen.queryByText("Nowhere.")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing saved. One field needs a fix.",
    );
  });

  it.each([
    ["a string", "went wrong"],
    ["a plain Error", new Error("500")],
    ["an object with no issues at all", { message: "500" }],
    ["issues that are not issues", { issues: [{ nope: true }] }],
    ["issues that are not even a list", { issues: "lots" }],
  ])("treats %s as a form failure, not as field errors", async (_label, reason) => {
    await submitAndReject(reason);

    // The button, not the fields: nothing was saved and the fix is not
    // inside the form.
    expect(await screen.findByRole("button", { name: /try again/i })).toBeVisible();
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Brand")).not.toHaveAttribute("aria-invalid");
  });

  it("clears a failure band when the next attempt comes back with field errors", async () => {
    // `setFailure(undefined)` inside `land`. Without it the band from a
    // dropped connection outlives the retry, so the screen says the
    // connection failed while pointing at a field to fix.
    const user = userEvent.setup();
    const action = vi
      .fn<(values: z.output<typeof schema>) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("500"))
      .mockRejectedValueOnce({
        issues: [{ path: ["brand"], message: "Not that one." }],
      });
    render(<Harness action={action} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));
    const retry = await screen.findByRole("button", { name: /try again/i });

    await user.click(retry);

    expect(await screen.findByText("Not that one.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});

describe("the live region starts empty", () => {
  it("says nothing before a submit resolves", () => {
    // Permanently mounted and empty until an outcome. Seeded with any text
    // it would announce on arrival, and `sr-only` means nobody who could
    // report it would ever see it.
    render(<Harness action={() => Promise.resolve(undefined)} />);

    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

describe("the state a submit leaves behind", () => {
  it("treats issues that name no field as a form failure", async () => {
    // They cannot mark anything, so calling them field errors announced
    // "Nothing saved. 0 fields need a fix." — a sentence pointing at a fix
    // that is nowhere on screen. Nothing was saved and the fix is not
    // inside the form, which is the definition of a form failure.
    await submitAndReject({ issues: [{ path: [], message: "Nowhere." }] });

    expect(
      await screen.findByRole("button", { name: /try again/i }),
    ).toBeVisible();
    expect(screen.getByRole("status")).not.toHaveTextContent("0 fields");
  });

  it("clears the band when a later attempt succeeds", async () => {
    // `setFailure(undefined)` on entry to a submit. Without it the band
    // from the dropped connection is still on screen after the retry that
    // worked.
    const user = userEvent.setup();
    const action = vi
      .fn<(values: z.output<typeof schema>) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce(undefined);
    render(<Harness action={action} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));
    await user.click(await screen.findByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    });
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    // And it came to rest: a form left pending after a success is a button
    // that says it is still saving something already saved.
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).not.toHaveAttribute("aria-busy");
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("readonly");
  });

  it("succeeds cleanly for a form that passes no onSuccess at all", async () => {
    // `onSuccess?.()` — the option is optional, and most forms that stay
    // put do not pass one. Calling it unconditionally throws a TypeError,
    // which this hook classifies as a dropped connection: the save landed
    // and the screen would say the network failed.
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve(undefined)} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    });
    // Then let it settle and assert the sentence is *still* the success
    // one. A `waitFor` on "the band is absent" would pass on its first
    // poll — the band arrives a tick later, so a negative assertion cannot
    // wait for something that has not happened yet.
    // Longer than the hook's own announce-then-move grace, so the throw
    // this is ruling out has had its chance to happen. Shorter and the
    // assertion lands before the failure it is looking for.
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, DURATION.instant * 3);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("empties the live region while the next attempt is in flight", async () => {
    // `setStatus("")` on entry. Left holding the previous outcome, the
    // region would still be claiming the last failure while the retry is
    // running — and a region whose text does not change announces nothing
    // when the new outcome finally matches it.
    const user = userEvent.setup();
    const second = Promise.withResolvers<undefined>();
    const action = vi
      .fn<(values: z.output<typeof schema>) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("500"))
      .mockImplementationOnce(() => second.promise);
    render(<Harness action={action} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(screen.getByRole("status")).toHaveTextContent(/^Nothing saved\./);

    await user.click(retry);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("");
    });
    second.resolve(undefined);
  });

  it("clears field marks once the values are accepted", async () => {
    // `setFieldErrors({})` on success. A field left marked after the save
    // worked says the value is wrong while it is sitting in the database.
    const user = userEvent.setup();
    const action = vi
      .fn<(values: z.output<typeof schema>) => Promise<unknown>>()
      .mockRejectedValueOnce({
        issues: [{ path: ["brand"], message: "Not that one." }],
      })
      .mockResolvedValueOnce(undefined);
    render(<Harness action={action} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));
    await screen.findByText("Not that one.");

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    });
    expect(screen.getByLabelText("Brand")).not.toHaveAttribute("aria-invalid");
  });

  it("never marks a field for a failure that is not the field's fault", async () => {
    // The contract's own table: a form failure marks the button and *no*
    // field. A mark left over from an earlier field error would say the
    // fix is inside the form when nothing was saved at all.
    const user = userEvent.setup();
    const action = vi
      .fn<(values: z.output<typeof schema>) => Promise<unknown>>()
      .mockRejectedValueOnce({
        issues: [{ path: ["brand"], message: "Not that one." }],
      })
      .mockRejectedValueOnce(new Error("500"));
    render(<Harness action={action} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));
    await screen.findByText("Not that one.");

    await user.click(screen.getByRole("button", { name: /save/i }));

    await screen.findByRole("button", { name: /try again/i });
    expect(screen.getByLabelText("Brand")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Not that one.")).toBeNull();
  });

  it("comes back to rest after a failure, not just after a success", async () => {
    // The `finally`. A form stuck pending is a button that says it is
    // still working and a set of inputs that stay readOnly.
    const user = userEvent.setup();
    render(<Harness action={() => Promise.reject(new Error("500"))} />);

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save/i }));

    await screen.findByRole("button", { name: /try again/i });
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).not.toHaveAttribute("aria-busy");
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("readonly");
  });

  it("lets a corrected form through after the pre-check refused it", async () => {
    // The guard is released on the pre-check path too. Held, the form
    // would refuse every submit after the first invalid one — for the rest
    // of the page's life.
    const user = userEvent.setup();
    const action = vi.fn<(values: z.output<typeof schema>) => Promise<unknown>>(
      () => Promise.resolve(undefined),
    );
    render(<Harness action={action} />);

    // Brand missing: the pre-check refuses it without calling the action.
    await user.type(screen.getByLabelText("Name"), "Houdini");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await screen.findByText("Which brand?");
    expect(action).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Brand"), "Patagonia");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
  });

  it("clears only the field being typed in, not the other one", async () => {
    // `filter(([key]) => key !== name)`. Clearing everything would wipe a
    // mark the user has not looked at yet; clearing nothing would leave a
    // message under a field they have just fixed.
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve(undefined)} />);

    await user.click(screen.getByRole("button", { name: /save/i }));
    await screen.findByText("Give it a name.");
    expect(screen.getByText("Which brand?")).toBeVisible();

    await user.type(screen.getByLabelText("Name"), "H");

    await waitFor(() => {
      expect(screen.queryByText("Give it a name.")).toBeNull();
    });
    expect(screen.getByText("Which brand?")).toBeVisible();
  });

  it("describes an invalid field and leaves a valid one undescribed", async () => {
    // `aria-describedby` is how the message reaches a screen reader at
    // all, since the message itself is deliberately not a live region.
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve(undefined)} />);

    await user.type(screen.getByLabelText("Name"), "Houdini");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await screen.findByText("Which brand?");
    expect(screen.getByLabelText("Brand")).toHaveAttribute(
      "aria-describedby",
      "brand-message",
    );
    expect(screen.getByLabelText("Name")).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});

describe("the summary names a field", () => {
  it("uses the label it was given", async () => {
    const user = userEvent.setup();
    render(<Harness action={() => Promise.resolve(undefined)} />);

    await user.click(screen.getByRole("button", { name: /save/i }));

    // Two failures, so a summary — and its rows read as the labels a
    // person sees on the fields, not as the schema's keys.
    expect(await screen.findByRole("button", { name: /Name/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Brand/ })).toBeVisible();
  });

  it("falls back to the field's own name when given none", async () => {
    // `labels?.[name] ?? name` — the whole option is optional, so a form
    // that passes none still gets a usable summary rather than a row
    // labelled `undefined`.
    const user = userEvent.setup();
    render(
      <Harness action={() => Promise.resolve(undefined)} withLabels={false} />,
    );

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("button", { name: /^name/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^brand/ })).toBeVisible();
  });
});
