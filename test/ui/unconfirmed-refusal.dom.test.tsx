import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SyntheticEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { EMAIL_UNCONFIRMED_CODE } from "../../src/lib/auth-signal";
import type { ConfirmTrigger } from "../../src/lib/auth-signal";
import { FormStatus, useControlAction, useFormSubmit } from "../../src/ui";
import { didAnswerRefusal } from "../../src/ui/use-form-submit";
import type { ConfirmGate } from "../../src/ui";
import { UnconfirmedRefusalAnswer } from "../../src/ui/unconfirmed-refusal";

/**
 * A write refused for want of a confirmed address (design 133, decision
 * D-113): the server's `EMAIL_UNCONFIRMED` opens the root's "Confirm your
 * email first" from a control or a form, led by the control that was
 * refused, with no band and nothing announced — and anything else is
 * still a failure.
 */

/**
A server function's refusal, as it arrives: a plain object, cloned.
*/
async function refused(): Promise<never> {
  await Promise.resolve();
  throw Object.assign(new Error("Confirm your email first."), {
    code: EMAIL_UNCONFIRMED_CODE,
  });
}

async function broke(): Promise<never> {
  await Promise.resolve();
  throw new Error("D1 down");
}

function Control({
  action,
  trigger,
}: Readonly<{
  action: () => Promise<unknown>;
  trigger?: ConfirmTrigger;
}>) {
  const control = useControlAction<[]>({
    action,
    kicker: "Not following",
    confirmTrigger: trigger,
  });
  return (
    <>
      <FormStatus>{control.status}</FormStatus>
      <button
        type="button"
        onClick={() => {
          void control.run();
        }}
      >
        Follow
      </button>
      <p data-testid="band">{control.failure?.message ?? ""}</p>
    </>
  );
}

const noteSchema = z.object({ note: z.string() });

function NoteForm({
  action,
  trigger,
}: Readonly<{
  action: () => Promise<unknown>;
  trigger?: ConfirmTrigger;
}>) {
  const form = useFormSubmit({
    schema: noteSchema,
    action,
    successMessage: "Sent.",
    confirmTrigger: trigger,
  });
  return (
    <form
      onSubmit={(event: SyntheticEvent) => {
        event.preventDefault();
        void form.submit({ note: "spam" });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <button type="submit">Send report</button>
      <p data-testid="band">{form.failure?.message ?? ""}</p>
    </form>
  );
}

/**
 * The root's sheet, as a spy: a line naming the control that opened it
 * while open, and a way to shut it.
 */
function spyGate() {
  return vi.fn<ConfirmGate["sheet"]>(({ open, trigger }, onClose) =>
    open ? (
      <div role="dialog" aria-label="Confirm your email first">
        <p>Opened from {trigger ?? "nothing"}</p>
        <button type="button" onClick={onClose}>
          Not now
        </button>
      </div>
    ) : (
      <p>Shut, from {trigger ?? "nothing"}</p>
    ),
  );
}

function sheet() {
  return screen.queryByRole("dialog", { name: "Confirm your email first" });
}

function answers() {
  return {
    terms: vi.fn<() => void>(),
    unconfirmed: vi.fn<(trigger: ConfirmTrigger | undefined) => void>(),
  };
}

describe("an unconfirmed refusal, answered at the root (D-113)", () => {
  it("draws nothing until something is refused", () => {
    const gate = spyGate();
    render(
      <UnconfirmedRefusalAnswer gate={{ sheet: gate }}>
        <Control action={refused} trigger="follow" />
      </UnconfirmedRefusalAnswer>,
    );
    expect(gate).not.toHaveBeenCalled();
    expect(screen.queryByText(/Shut/u)).toBeNull();
  });

  it("opens the sheet from a control, led by it, and announces nothing", async () => {
    const gate = spyGate();
    render(
      <UnconfirmedRefusalAnswer gate={{ sheet: gate }}>
        <Control action={refused} trigger="follow" />
      </UnconfirmedRefusalAnswer>,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Follow" }));

    expect(await screen.findByText("Opened from follow")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByTestId("band")).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Follow" })).not.toHaveAttribute(
      "aria-busy",
    );
  });

  it("opens the sheet from a form, with no band and no sentence, and the form can send again", async () => {
    const action = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(refused)
      .mockResolvedValueOnce(undefined);
    render(
      <UnconfirmedRefusalAnswer gate={{ sheet: spyGate() }}>
        <NoteForm action={action} trigger="report" />
      </UnconfirmedRefusalAnswer>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByText("Opened from report")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByTestId("band")).toHaveTextContent("");

    await user.click(screen.getByRole("button", { name: "Not now" }));
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Sent.");
    });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("opens with no lead when the form names no control", async () => {
    render(
      <UnconfirmedRefusalAnswer gate={{ sheet: spyGate() }}>
        <NoteForm action={refused} />
      </UnconfirmedRefusalAnswer>,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByText("Opened from nothing")).toBeVisible();
  });

  it("keeps the trigger as it shuts, and takes the next one when opened again", async () => {
    render(
      <UnconfirmedRefusalAnswer gate={{ sheet: spyGate() }}>
        <Control action={refused} trigger="follow" />
        <NoteForm action={refused} trigger="report" />
      </UnconfirmedRefusalAnswer>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Follow" }));
    await screen.findByText("Opened from follow");
    await user.click(screen.getByRole("button", { name: "Not now" }));
    // Shut, still saying which control it was: the sentence does not
    // change under a closing sheet.
    expect(screen.getByText("Shut, from follow")).toBeInTheDocument();
    expect(sheet()).toBeNull();

    await user.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText("Opened from report")).toBeVisible();
  });

  it("leaves any other failure to the control's band, even with the answer above", async () => {
    const gate = spyGate();
    render(
      <UnconfirmedRefusalAnswer gate={{ sheet: gate }}>
        <Control action={broke} trigger="follow" />
      </UnconfirmedRefusalAnswer>,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() => {
      expect(screen.getByTestId("band")).toHaveTextContent("Our end failed.");
    });
    expect(gate).not.toHaveBeenCalled();
  });

  it("leaves any other failure to the form's band, even with the answer above", async () => {
    const gate = spyGate();
    render(
      <UnconfirmedRefusalAnswer gate={{ sheet: gate }}>
        <NoteForm action={broke} trigger="report" />
      </UnconfirmedRefusalAnswer>,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Nothing saved. Our end failed. Nothing changed.",
      );
    });
    expect(gate).not.toHaveBeenCalled();
  });

  it("is the refusal's cause line where nothing above answers it", async () => {
    render(<Control action={refused} trigger="follow" />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() => {
      expect(screen.getByTestId("band")).toHaveTextContent(
        "Confirm your email first.",
      );
    });
  });

  it("is a form's failure band where nothing above answers it", async () => {
    render(<NoteForm action={refused} trigger="report" />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Nothing saved. Confirm your email first.",
      );
    });
  });
});

describe("didAnswerRefusal, with both answers above", () => {
  it("sends an unconfirmed refusal to the confirm sheet alone, with its trigger", () => {
    const both = answers();
    expect(didAnswerRefusal("unconfirmed", both, "follow")).toBe(true);
    expect(both.unconfirmed).toHaveBeenCalledWith("follow");
    expect(both.terms).not.toHaveBeenCalled();
  });

  it("sends a terms refusal to the terms prompt alone", () => {
    const both = answers();
    expect(didAnswerRefusal("terms", both, "follow")).toBe(true);
    expect(both.terms).toHaveBeenCalledOnce();
    expect(both.unconfirmed).not.toHaveBeenCalled();
  });

  it("answers nothing else, and nothing without its own answer", () => {
    const both = answers();
    expect(didAnswerRefusal("server", both, undefined)).toBe(false);
    expect(
      didAnswerRefusal(
        "unconfirmed",
        { terms: both.terms, unconfirmed: undefined },
        undefined,
      ),
    ).toBe(false);
    expect(
      didAnswerRefusal(
        "terms",
        { terms: undefined, unconfirmed: both.unconfirmed },
        undefined,
      ),
    ).toBe(false);
    expect(both.terms).not.toHaveBeenCalled();
    expect(both.unconfirmed).not.toHaveBeenCalled();
  });
});
