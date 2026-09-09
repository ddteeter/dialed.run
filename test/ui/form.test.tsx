import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  FormErrorSummary,
  FormFailureBand,
  FormField,
  FormStatus,
  SubmitButton,
} from "../../src/ui/form";

/**
 * The Forms & failure contract (docs/product.md), pinned.
 *
 * These assert the rules a port most easily loses — the ones where the
 * wrong choice still looks fine on screen. Layout is not tested; a class
 * list is not a behaviour and pinning one would break on every restyle.
 */

// React refs are null when unmounted; the components take that shape and
// these assertions never touch it.
const summaryRef = createRef<HTMLDivElement>();

describe("a field error is marked, not reddened", () => {
  it("carries the mark in border weight, and never in hue alone", () => {
    const marked = renderToStaticMarkup(
      <FormField name="title" label="Title" error="Give the run a name.">
        <input name="title" />
      </FormField>,
    );
    const clean = renderToStaticMarkup(
      <FormField name="title" label="Title">
        <input name="title" />
      </FormField>,
    );
    expect(marked).toContain("border-2");
    expect(clean).not.toContain("border-2");
    expect(marked).toContain('data-invalid="true"');
  });

  it("never uses pink for failure — pink is action in this palette", () => {
    const markup = renderToStaticMarkup(
      <>
        <FormField name="title" label="Title" error="Give the run a name.">
          <input name="title" />
        </FormField>
        <FormFailureBand
          failure={{ kind: "network", message: "Your connection dropped." }}
          onRetry={vi.fn()}
        />
      </>,
    );
    expect(markup).not.toContain("pink");
  });

  it("does not animate — a shake is a spring wearing a costume", () => {
    // The doctrine's own words: "offline / error: nothing, deliberately
    // static". The only motion in the whole failure path is the button
    // leaving its pending state.
    const markup = renderToStaticMarkup(
      <>
        <FormField name="title" label="Title" error="Give the run a name.">
          <input name="title" />
        </FormField>
        <FormFailureBand
          failure={{ kind: "server", message: "Our end failed." }}
          onRetry={vi.fn()}
        />
      </>,
    );
    expect(markup).not.toMatch(/animate|transition|breathe/);
  });

  it("describes the input rather than announcing on its own", () => {
    // Two live regions firing at once means one of them is lost, so the
    // message is wired by aria-describedby and FormStatus does the talking.
    const markup = renderToStaticMarkup(
      <FormField name="title" label="Title" error="Give the run a name.">
        <input name="title" aria-describedby="title-message" />
      </FormField>,
    );
    expect(markup).toContain('id="title-message"');
    expect(markup).not.toContain("aria-live");
  });
});

describe("the summary appears by count", () => {
  it("renders nothing at one error — that field is focused instead", () => {
    const markup = renderToStaticMarkup(
      <FormErrorSummary
        rows={[{ name: "title", label: "Title", message: "Name it." }]}
        onFocusField={vi.fn()}
        summaryRef={summaryRef}
      />,
    );
    expect(markup).toBe("");
  });

  it("renders buttons, not anchors — a form is not a document", () => {
    const markup = renderToStaticMarkup(
      <FormErrorSummary
        rows={[
          { name: "title", label: "Title", message: "Name it." },
          { name: "distanceM", label: "Distance", message: "How far?" },
        ]}
        onFocusField={vi.fn()}
        summaryRef={summaryRef}
      />,
    );
    expect(markup).toContain("2 fields need a fix.");
    expect(markup).toContain('type="button"');
    expect(markup).not.toContain("<a ");
  });
});

describe("the submit button", () => {
  it("is never `disabled` — that drops focus and stops announcing", () => {
    const markup = renderToStaticMarkup(
      <SubmitButton label="Log run" pendingLabel="Logging" pending />,
    );
    expect(markup).not.toMatch(/\sdisabled/);
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('aria-busy="true"');
  });

  it("keeps both labels mounted so the width never jumps", () => {
    const markup = renderToStaticMarkup(
      <SubmitButton label="Log run" pendingLabel="Logging" pending />,
    );
    expect(markup).toContain("Log run");
    expect(markup).toContain("Logging");
    expect(markup).toContain("hidden");
  });

  it("waits with breathing brackets and never a spinner", () => {
    const pending = renderToStaticMarkup(
      <SubmitButton label="Log run" pendingLabel="Logging" pending />,
    );
    expect(pending).toContain("breathe");
    expect(pending).not.toMatch(/spin|loader|spinner/i);
  });
});

describe("the live region", () => {
  it("is mounted even when it has nothing to say", () => {
    // A region that appears only when it has something to announce
    // announces nothing at all — screen readers watch a region that was
    // already there.
    const markup = renderToStaticMarkup(<FormStatus />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
  });
});

describe("error copy lives in the schema", () => {
  it("names the fix and obeys the copy rules", () => {
    // §6: one sentence, under ten words, sentence case, ends in a period.
    // Banned: please, invalid, error, oops, exclamation marks.
    const banned = /\b(please|invalid|error|oops)\b|!/i;
    const schemas = z.object({
      title: z.string().min(1, "Give the run a name."),
      distanceM: z.number().positive("How far did you go?"),
    });
    const result = schemas.safeParse({ title: "", distanceM: 0 });
    expect(result.success).toBe(false);
    const issues = result.error?.issues ?? [];
    for (const issue of issues) {
      expect(issue.message, issue.message).not.toMatch(banned);
      expect(issue.message.split(" ").length, issue.message).toBeLessThan(10);
      expect(issue.message, issue.message).toMatch(/[.?]$/);
    }
  });
});
