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
}: Readonly<{ action: (values: z.output<typeof schema>) => Promise<unknown> }>) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const form = useFormSubmit({
    schema,
    action,
    successMessage: "Saved.",
    labels: { name: "Name", brand: "Brand" },
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
