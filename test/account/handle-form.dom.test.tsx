import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HandleForm } from "../../src/modules/account/components/HandleForm";
import { HandleStep } from "../../src/modules/account/components/HandleStep";
import type { HandleClaim } from "../../src/modules/account/username";

/**
 * O0 and Settings › Username (round 26 #7): one field, checked on Next,
 * lowercased as typed, and the server's "taken" landing on the field.
 */
function renderForm(
  answer: (username: string) => HandleClaim = (username) => ({
    kind: "claimed",
    username,
  }),
  options: { initial?: string; withNext?: boolean } = {},
) {
  const claim = vi.fn((input: { data: { username: string } }) =>
    Promise.resolve(answer(input.data.username)),
  );
  const onClaimed = vi.fn();
  render(
    <HandleForm
      initial={options.initial}
      claim={claim}
      submitLabel="Next"
      pendingLabel="Checking"
      successMessage="Handle saved."
      onClaimed={options.withNext === false ? undefined : onClaimed}
    />,
  );
  return { claim, onClaimed, user: userEvent.setup() };
}

const field = () => screen.getByRole("textbox", { name: "Username" });
const next = () => screen.getByRole("button", { name: "Next" });

describe("the field", () => {
  it("is labelled, hinted as the board words it, and starts from what is saved", () => {
    renderForm(undefined, { initial: "maya_runs" });
    expect(field()).toHaveValue("maya_runs");
    expect(
      screen.getByText(
        "3–20 letters, numbers or _. It's on everything you share. You can change it in settings.",
      ),
    ).toBeVisible();
    expect(field()).toHaveAttribute("autocomplete", "username");
    expect(field()).toHaveAttribute("autocapitalize", "none");
    expect(field()).toHaveAttribute("spellcheck", "false");
    // The @ is drawn in the box, and is not part of what is typed.
    expect(screen.getByText("@")).toHaveAttribute("aria-hidden", "true");
  });

  it("starts empty at O0", () => {
    renderForm();
    expect(field()).toHaveValue("");
  });

  it("lowercases as the runner types, so they see what is stored", async () => {
    const { user } = renderForm();
    await user.type(field(), "@Maya_Runs");
    expect(field()).toHaveValue("maya_runs");
  });
});

describe("Next", () => {
  it("is checked on Next, not while typing", async () => {
    const { claim, user } = renderForm();
    await user.type(field(), "_m");
    expect(screen.queryByText(/Use 3–20/u)).toBeNull();
    await user.click(next());
    expect(
      await screen.findByText("Use 3–20 letters, numbers or _."),
    ).toBeVisible();
    expect(claim).not.toHaveBeenCalled();
  });

  it("claims the handle and moves on once it is saved", async () => {
    const { claim, onClaimed, user } = renderForm();
    await user.type(field(), "maya_runs");
    await user.click(next());
    await waitFor(() => {
      expect(onClaimed).toHaveBeenCalledOnce();
    });
    expect(claim).toHaveBeenCalledWith({ data: { username: "maya_runs" } });
    expect(screen.getByRole("status")).toHaveTextContent("Handle saved.");
  });

  it("stays put when there is nowhere to go (Settings › Username)", async () => {
    const { claim, onClaimed, user } = renderForm(undefined, {
      initial: "dee",
      withNext: false,
    });
    await user.click(next());
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Handle saved.");
    });
    expect(claim).toHaveBeenCalledOnce();
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it("lands a taken handle on the field with the one suggestion", async () => {
    const { onClaimed, user } = renderForm((username) => ({
      kind: "taken",
      username,
      suggestion: "maya_runs_pdx",
    }));
    await user.type(field(), "maya_runs");
    await user.click(next());
    expect(
      await screen.findByText(
        "@maya_runs is taken. Try another, like @maya_runs_pdx.",
      ),
    ).toBeVisible();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it("says taken without a suggestion when there is none", async () => {
    const { user } = renderForm((username) => ({
      kind: "taken",
      username,
      suggestion: undefined,
    }));
    await user.type(field(), "admin");
    await user.click(next());
    expect(
      await screen.findByText("@admin is taken. Try another."),
    ).toBeVisible();
  });

  it("gives a server fault the form's band, not the field", async () => {
    const claim = vi.fn(() => Promise.reject(new Error("boom")));
    render(
      <HandleForm
        claim={claim}
        submitLabel="Next"
        pendingLabel="Checking"
        successMessage="Handle saved."
      />,
    );
    const user = userEvent.setup();
    await user.type(field(), "maya_runs");
    await user.click(next());
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeVisible();
    expect(field()).not.toHaveAttribute("aria-invalid");
  });
});

describe("the submit", () => {
  it("stays on the page: the browser's own submit is prevented", async () => {
    const { claim } = renderForm(undefined, { initial: "dee" });
    const form = field().closest("form");
    if (form === null) throw new Error("no form");
    const submit = createEvent.submit(form);
    fireEvent(form, submit);
    expect(submit.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(claim).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Handle saved.");
    });
  });
});

describe("O0's head", () => {
  it("puts the step kicker over the question, and the form under it", () => {
    render(
      <HandleStep>
        <p>the form</p>
      </HandleStep>,
    );
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "What should runners call you?",
    });
    const kicker = screen.getByText("Step 1 of 4");
    expect(kicker.compareDocumentPosition(heading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(heading.compareDocumentPosition(screen.getByText("the form"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
