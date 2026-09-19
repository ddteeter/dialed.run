import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { reportReasons } from "../../src/modules/safety/contracts";
import { ReportSheet } from "../../src/modules/safety/components/ReportSheet";

type SheetProps = Parameters<typeof ReportSheet>[0];

/**
 * A subject with nobody to name — a product, say.
 */
const anonymousSubject: SheetProps["subject"] = {
  type: "product",
  id: "p-1",
  label: "Some Shoe",
};

function renderSheet(overrides: Partial<SheetProps> = {}) {
  // Typed rather than a bare `vi.fn()`: an untyped mock makes every
  // assertion against it an `any`, which the lint rules reject and which
  // would also let a wrong call shape pass unnoticed.
  const fileReport: SheetProps["fileReport"] = vi
    .fn<SheetProps["fileReport"]>()
    .mockResolvedValue({ reporterCount: 1 });
  const onFiled = vi.fn();
  const onClose = vi.fn();
  render(
    <ReportSheet
      open
      onClose={onClose}
      subject={{
        type: "entry",
        id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        label: "mark_t · yesterday",
        authorName: "mark_t",
      }}
      canBlock
      fileReport={fileReport}
      onFiled={onFiled}
      {...overrides}
    />,
  );
  return { fileReport, onFiled, onClose };
}

describe("W1's reasons", () => {
  it("offers the artboard's sentences, not policy categories", () => {
    renderSheet();

    // The exact copy, because W1's own note is that these are "sentences a
    // runner would say". A rewrite into `sexual_content` / `harassment` /
    // `spam` would be inventing design language on a designed surface.
    expect(
      screen.getByRole("radio", {
        name: "The photo shows someone inappropriately",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "This isn't their run or their gear" }),
    ).toBeInTheDocument();
  });

  it("offers every reason the contract defines", () => {
    renderSheet();
    // Derived from the table rather than a second list here: a reason
    // added to `reportReasons` and not to the sheet would otherwise be a
    // silent gap.
    expect(screen.getAllByRole("radio")).toHaveLength(reportReasons.length);
  });
});

describe("what the sheet promises", () => {
  it("tells the reporter what happens next, in the artboard's words", () => {
    renderSheet();

    // Each sentence is a promise the code keeps, so the copy is pinned:
    // a person reads it, the entry goes from your feed immediately, and
    // the author is never told who reported them.
    expect(screen.getByText(/A person reads it within a day/)).toBeInTheDocument();
    expect(
      screen.getByText(/hidden from your feed straight away/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/never told who\s+reported it/),
    ).toBeInTheDocument();
  });

  it("names the author in the block option", () => {
    renderSheet();
    expect(
      screen.getByRole("checkbox", { name: "Block mark_t as well" }),
    ).toBeInTheDocument();
  });

  it("does not offer a block when there is nobody to block", () => {
    renderSheet({ canBlock: false, subject: anonymousSubject });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("avoids inventing a name when the subject has no author", () => {
    renderSheet({ subject: anonymousSubject, canBlock: false });
    // A pronoun, not an empty gap where a handle would be.
    //
    // This assertion used to read `/them is never told/` and passed,
    // which is how the sentence actually rendered — the test pinned the
    // bug rather than the promise. Asserting the rendered string is not
    // the same as asserting it reads as English, and a regex is happy
    // either way. Raised on PR #73.
    expect(
      screen.getByText(/They are never told who reported it\./),
    ).toBeInTheDocument();
  });
});

describe("filing a report", () => {
  it("sends the chosen reason and closes", async () => {
    const user = userEvent.setup();
    const { fileReport, onFiled, onClose } = renderSheet();

    await user.click(
      screen.getByRole("radio", { name: "It's an ad, or it's spam" }),
    );
    await user.click(screen.getByRole("button", { name: "Send report" }));

    // onSuccess runs after the action resolves, so the callbacks are part
    // of what we wait for rather than something to assert straight after.
    await waitFor(() => {
      expect(onFiled).toHaveBeenCalled();
    });
    // Reading the recorded argument rather than `expect.objectContaining`,
    // which is typed `any` and would let a wrong call shape through.
    const [call] = vi.mocked(fileReport).mock.calls;
    expect(call?.[0].data).toMatchObject({
      subjectType: "entry",
      subjectId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      reason: "spam",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("carries the block choice with the report rather than separately", async () => {
    const user = userEvent.setup();
    const { fileReport } = renderSheet();

    await user.click(
      screen.getByRole("radio", { name: "Harassment aimed at someone" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Block mark_t as well" }),
    );
    await user.click(screen.getByRole("button", { name: "Send report" }));

    // One call, not two. A reporter who ticked the box and lost a second
    // request would be told the report worked while the block silently
    // did not.
    await waitFor(() => {
      expect(fileReport).toHaveBeenCalledTimes(1);
    });
    const [call] = vi.mocked(fileReport).mock.calls;
    expect(call?.[0].data).toMatchObject({
      alsoBlock: true,
      reason: "harassment",
    });
  });

  it("refuses to send without a reason, and says so", async () => {
    const user = userEvent.setup();
    const { fileReport } = renderSheet();

    await user.click(screen.getByRole("button", { name: "Send report" }));

    // The schema's own sentence, not zod's default — which would read
    // "Invalid option: expected one of \"explicit\"|\"harassment\"…" and
    // leak the stored values onto a sheet whose words are meant to be the
    // runner's. One missing field shows the field's message rather than
    // the summary, which deliberately stays quiet under two errors.
    await waitFor(() => {
      expect(screen.getByText("Pick what's wrong with it.")).toBeInTheDocument();
    });
    expect(fileReport).not.toHaveBeenCalled();
  });

  it("starts with an empty note, so nothing is sent that nobody typed", () => {
    renderSheet();

    // The note is free text on a sheet whose words are the runner's. A
    // pre-filled one puts words in their mouth and files them.
    expect(screen.getByLabelText(/Anything else/)).toHaveValue("");
  });

  it("sends a note when one was typed", async () => {
    const user = userEvent.setup();
    const { fileReport } = renderSheet();

    await user.click(screen.getByRole("radio", { name: "Something else" }));
    await user.type(screen.getByLabelText(/Anything else/), "they keep at it");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => {
      expect(fileReport).toHaveBeenCalled();
    });
    const [call] = vi.mocked(fileReport).mock.calls;
    expect(call?.[0].data.note).toBe("they keep at it");
  });

  it("sends no note at all rather than an empty one", async () => {
    const user = userEvent.setup();
    const { fileReport } = renderSheet();

    await user.click(screen.getByRole("radio", { name: "Something else" }));
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => {
      expect(fileReport).toHaveBeenCalled();
    });
    // `undefined`, not `""`. A missing note and an empty note are the
    // same fact, and storing two spellings of it is how one gets missed
    // by a reader later.
    const [call] = vi.mocked(fileReport).mock.calls;
    expect(call?.[0].data.note).toBeUndefined();
  });

  it("says the report was sent, in the artboard's words", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole("radio", { name: "Something else" }));
    await user.click(screen.getByRole("button", { name: "Send report" }));

    // The forms contract puts the outcome in a status region. Silence
    // after a send is indistinguishable from a send that failed.
    await waitFor(() => {
      expect(screen.getByText("Report sent.")).toBeInTheDocument();
    });
  });

  it("names the fields in the summary the way the sheet labels them", async () => {
    const user = userEvent.setup();
    renderSheet();

    // Two errors at once — a missing reason and an over-long note — which
    // is what brings the summary out. Without the labels it lists the
    // schema's field names, so a reporter reads "note" and "reason"
    // rather than the words above the inputs they just filled in.
    await user.type(screen.getByLabelText(/Anything else/), "x".repeat(501));
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => {
      expect(screen.getByText("Nothing saved")).toBeInTheDocument();
    });
    const summary = screen.getByText("Nothing saved").parentElement;
    if (!summary) throw new Error("the summary has no container");
    expect(within(summary).getByText(/What's wrong with it/)).toBeInTheDocument();
    expect(within(summary).getByText(/Anything else/)).toBeInTheDocument();
  });

  it("keeps the browser out of it, so a failed report does not reload the page", async () => {
    const user = userEvent.setup();
    renderSheet();
    let prevented: boolean | undefined;
    document.addEventListener(
      "submit",
      (event) => {
        prevented = event.defaultPrevented;
      },
      { once: true },
    );

    await user.click(screen.getByRole("radio", { name: "Something else" }));
    await user.click(screen.getByRole("button", { name: "Send report" }));

    // A native submit navigates, which throws away the sheet, the status
    // region and any error the server was about to report.
    await waitFor(() => {
      expect(prevented).toBe(true);
    });
  });

  it("never disables the submit button", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole("radio", { name: "Something else" }));
    const button = screen.getByRole("button", { name: /Send report|Sending/ });

    // The forms contract: `disabled` drops focus and stops announcing, so
    // the guard is aria-disabled plus a handler-level double-submit check.
    expect(button).not.toBeDisabled();
  });
});

describe("naming the author when there is one", () => {
  it("uses the handle and the singular verb", () => {
    // The other half of the fallback: a name is singular ("mark_t is"),
    // the pronoun is not ("They are"), so one string could never serve
    // both and the sentence needs its own.
    renderSheet();
    expect(
      screen.getByText(/mark_t is never told who reported it\./),
    ).toBeInTheDocument();
  });
});

describe("the block offer needs somebody to name", () => {
  it("withholds it when the caller allows blocking but names nobody", () => {
    // `canBlock` and `authorName` have always had to agree, and nothing
    // made them: a caller passing one without the other rendered
    // "Block  as well", with a gap where the handle goes. The component
    // now refuses the state rather than filling the gap with a word.
    renderSheet({ subject: anonymousSubject, canBlock: true });

    expect(
      screen.queryByRole("checkbox", { name: /^Block/ }),
    ).not.toBeInTheDocument();
  });

  it("still offers it, named, when there is an author", () => {
    renderSheet();
    expect(
      screen.getByRole("checkbox", { name: "Block mark_t as well" }),
    ).toBeInTheDocument();
  });

  it("sends no block field at all when there is nobody to block", async () => {
    // `undefined`, not `false`. The two behave identically on the server
    // today — `fileReport` tests `alsoBlock === true` — so nothing would
    // have noticed the difference, which is exactly why it is worth
    // pinning: a product report carrying `alsoBlock: false` is a claim
    // about blocking on a subject that cannot be blocked, and the next
    // person to read that field should not have to work out that it was
    // noise.
    const user = userEvent.setup();
    const { fileReport } = renderSheet({
      subject: anonymousSubject,
      canBlock: true,
    });

    await user.click(
      screen.getByRole("radio", { name: "Harassment aimed at someone" }),
    );
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => {
      expect(fileReport).toHaveBeenCalledTimes(1);
    });
    const [call] = vi.mocked(fileReport).mock.calls;
    expect(call?.[0].data.alsoBlock).toBeUndefined();
  });
});
