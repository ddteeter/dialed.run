import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ReminderDayLine,
  reminderDayLabel,
} from "../../src/modules/runs/components/ReminderDayLine";

/**
 * Round 56 · 250: A1 names the day a Strava reminder carried, under
 * "Enter the run by hand".
 */
describe("ReminderDayLine", () => {
  it("names the day in the ruling's words, TYPE.small in --quiet", () => {
    render(<ReminderDayLine day="2026-11-12" />);
    const line = screen.getByText(
      "It starts on Thu, Nov 12, the day of your Strava reminder.",
    );
    expect(line.tagName).toBe("P");
    expect(line).toHaveClass("text-small", "text-quiet", "text-center", "m-0");
    expect(line).toHaveAttribute("data-part", "reminder-day");
  });

  it("draws nothing without a reminder's day", () => {
    const { container } = render(<ReminderDayLine day={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("reminderDayLabel", () => {
  it("reads the calendar day itself, whatever the zone", () => {
    expect(reminderDayLabel("2026-11-12")).toBe("Thu, Nov 12");
    // The first and last minutes of a day are the same day on UTC.
    expect(reminderDayLabel("2026-01-01")).toBe("Thu, Jan 1");
    expect(reminderDayLabel("2026-12-31")).toBe("Thu, Dec 31");
  });
});
