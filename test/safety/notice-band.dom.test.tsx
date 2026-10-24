import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ContentRemoved,
  PhotoBeingChecked,
} from "../../src/modules/safety/components/NoticeBand";

/**
 * Round 27 #20 and #21: the bands that stand where a photo or an entry
 * was, in the copy the rulings draw.
 */

function band(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    "[data-part='notice-band']",
  );
  if (found === null) throw new Error("no band");
  return found;
}

describe("PhotoBeingChecked (R-69)", () => {
  it("says who can see it, and for how long", () => {
    render(<PhotoBeingChecked />);
    expect(band()).toHaveTextContent(
      "Being checkedOther runners can't see this photo until it's checked, usually within a day.",
    );
    expect(band().children).toHaveLength(2);
  });
});

describe("ContentRemoved (SAF-8)", () => {
  it("names a removed photo, why, and what stays", () => {
    render(
      <ContentRemoved subjectType="photo" action="remove" reason="home" />,
    );
    expect(screen.getByText("Photo removed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A moderator removed this photo: it shows where someone lives.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Your run and verdict stay.")).toBeInTheDocument();
    // C8 (D-145): and the rule it broke, last.
    expect(band().lastElementChild).toHaveTextContent(
      /^That breaks our community rules: don't show where someone lives\.$/u,
    );
  });

  it("names a removed entry and its rule, with nothing said to stay", () => {
    render(
      <ContentRemoved subjectType="entry" action="remove" reason="spam" />,
    );
    expect(screen.getByText("Removed from the feed")).toBeInTheDocument();
    expect(band()).toHaveTextContent(
      /^Removed from the feedA moderator removed this entry from the feed: it's an ad or spam\.That breaks our community rules: don't post spam, advertising or promotion we have not allowed\.$/u,
    );
    expect(band().children).toHaveLength(3);
  });

  it("names no rule for the Desk's catch-all reason", () => {
    render(
      <ContentRemoved subjectType="entry" action="remove" reason="rules" />,
    );
    expect(band().children).toHaveLength(2);
  });

  it("says a takedown answered a copyright notice (round 28 #8)", () => {
    render(
      <ContentRemoved
        subjectType="photo"
        action="takedown"
        reason="copyright"
      />,
    );
    // A notice is why, so no rule is named (C8).
    expect(band()).toHaveTextContent(
      /^Photo removedWe removed this photo after a copyright notice\.Your run and verdict stay\.$/u,
    );
  });

  it("gives a removal request's takedown its reason: no copyright notice was sent", () => {
    render(
      <ContentRemoved
        subjectType="photo"
        action="takedown"
        reason="intimate"
      />,
    );
    expect(band()).toHaveTextContent(
      /^Photo removedA moderator removed this photo: it's an intimate image shared without consent\.Your run and verdict stay\.That breaks our community rules: don't post sexual or explicit content\.$/u,
    );
  });

  it("says the same of an entry taken down, in its own noun", () => {
    render(
      <ContentRemoved
        subjectType="entry"
        action="takedown"
        reason="copyright"
      />,
    );
    expect(band()).toHaveTextContent(
      "Removed from the feedWe removed this entry from the feed after a copyright notice.",
    );
    expect(band().children).toHaveLength(2);
  });
});
