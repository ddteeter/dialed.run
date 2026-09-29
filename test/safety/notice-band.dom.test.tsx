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

describe("PhotoBeingChecked (D-69)", () => {
  it("says who can see it, and for how long", () => {
    render(<PhotoBeingChecked />);
    expect(band()).toHaveTextContent(
      "Being checkedOnly you can see this photo until it's checked, usually within a day.",
    );
    expect(band().children).toHaveLength(2);
  });
});

describe("ContentRemoved (SAF-8)", () => {
  it("names a removed photo, why, and what stays", () => {
    render(<ContentRemoved subjectType="photo" reason="home" />);
    expect(screen.getByText("Photo removed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A moderator removed this photo: it shows where someone lives.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Your run and verdict stay.")).toBeInTheDocument();
  });

  it("names a removed entry, with nothing said to stay", () => {
    render(<ContentRemoved subjectType="entry" reason="spam" />);
    expect(screen.getByText("Removed from the feed")).toBeInTheDocument();
    expect(band()).toHaveTextContent(
      "A moderator removed this entry from the feed: it's an ad or spam.",
    );
    expect(band().children).toHaveLength(2);
  });
});
