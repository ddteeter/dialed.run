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
import {
  HandleStep,
  renamedLine,
} from "../../src/modules/account/components/HandleStep";
import { OnboardingHandle } from "../../src/modules/account/components/OnboardingHandle";
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

const NOTICE = {
  previous: "quadzilla_69",
  current: "runner_4821",
  reason: "Offensive or sexual",
};

/**
O0's re-pick for NOTICE, with Keep as given and every claim succeeding.
*/
function renderRepick(keep: () => Promise<unknown> = () => Promise.resolve()) {
  const claim = vi.fn((input: { data: { username: string } }) =>
    Promise.resolve<HandleClaim>({
      kind: "claimed",
      username: input.data.username,
    }),
  );
  const onFirstHandle = vi.fn();
  const onRepicked = vi.fn();
  render(
    <OnboardingHandle
      notice={NOTICE}
      claim={claim}
      keep={keep}
      onFirstHandle={onFirstHandle}
      onRepicked={onRepicked}
    />,
  );
  return { claim, onFirstHandle, onRepicked, user: userEvent.setup() };
}

describe("O0's re-pick after a moderator's rename (ACC-12; round 27 #16)", () => {

  it("says what was taken, what stands in, and why, as the board draws it", () => {
    renderRepick();
    const kicker = screen.getByText("Username changed by a moderator");
    expect(kicker).toHaveClass("text-cold-text");
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Pick a new username",
    });
    expect(kicker.compareDocumentPosition(heading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      screen.getByText(
        "@quadzilla_69 broke the rules on names: offensive or sexual. For now you're @runner_4821. Your runs and closet haven't changed.",
      ),
    ).toBeVisible();
    expect(screen.getByText("3–20 letters, numbers or _.")).toBeVisible();
    expect(screen.queryByText("Step 1 of 4")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save username" }),
    ).toBeInTheDocument();
  });

  it("saves a new username, then goes home", async () => {
    const { claim, onRepicked, onFirstHandle, user } = renderRepick();
    await user.type(field(), "quiet_mile");
    await user.click(screen.getByRole("button", { name: "Save username" }));
    await waitFor(() => {
      expect(onRepicked).toHaveBeenCalledTimes(1);
    });
    expect(claim).toHaveBeenCalledWith({ data: { username: "quiet_mile" } });
    expect(onFirstHandle).not.toHaveBeenCalled();
  });

  it("keeps the placeholder for now, then goes home", async () => {
    const keep = vi.fn(() => Promise.resolve());
    const { onRepicked, user } = renderRepick(keep);
    await user.click(
      screen.getByRole("button", { name: "Keep @runner_4821 for now" }),
    );
    await waitFor(() => {
      expect(onRepicked).toHaveBeenCalledTimes(1);
    });
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it("says Not kept when Keep fails, and tries it again", async () => {
    const keep = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(undefined);
    const { onRepicked, user } = renderRepick(keep);
    await user.click(
      screen.getByRole("button", { name: "Keep @runner_4821 for now" }),
    );
    expect(await screen.findByText("Not kept")).toBeVisible();
    expect(onRepicked).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(onRepicked).toHaveBeenCalledTimes(1);
    });
  });

  it("is O0's first pick with no notice: Next goes on to O1, and nothing to keep", async () => {
    const claim = vi.fn(() =>
      Promise.resolve<HandleClaim>({ kind: "claimed", username: "dee" }),
    );
    const onFirstHandle = vi.fn();
    const onRepicked = vi.fn();
    render(
      <OnboardingHandle
        notice={undefined}
        claim={claim}
        keep={vi.fn()}
        onFirstHandle={onFirstHandle}
        onRepicked={onRepicked}
      />,
    );
    expect(screen.getByText("Step 1 of 4")).toHaveClass("text-muted");
    expect(screen.queryByRole("button", { name: /^Keep/u })).toBeNull();
    const user = userEvent.setup();
    await user.type(field(), "dee");
    await user.click(next());
    await waitFor(() => {
      expect(onFirstHandle).toHaveBeenCalledTimes(1);
    });
    expect(onRepicked).not.toHaveBeenCalled();
  });

  it("reads every reason on the fixed list mid-sentence", () => {
    expect(
      renamedLine({ ...NOTICE, reason: "Pretends to be someone else" }),
    ).toContain("names: pretends to be someone else. For now");
    expect(renamedLine({ ...NOTICE, reason: "Advertising" })).toContain(
      "names: advertising.",
    );
  });
});
