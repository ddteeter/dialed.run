import type { JSX } from "react";

/**
 * A carried day as Round 56 · 250 writes it, "Thu, Nov 12". The day is a
 * calendar day, not an instant, so it is read on UTC, where its midnight
 * is that same day whoever reads it.
 */
export function reminderDayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * Round 56 · 250: A1 names the day a Strava reminder carried, under "Enter
 * the run by hand", the only path the day reaches (R1's Started starts on
 * it). A dropped file's own start wins, so nothing else on A1 reads it.
 * With no reminder there is no line.
 */
export function ReminderDayLine({
  day,
}: Readonly<{ day: string | undefined }>): JSX.Element | undefined {
  if (day === undefined) return;
  return (
    <p
      data-part="reminder-day"
      className="m-0 text-center text-small text-quiet desk:max-w-column"
    >
      {`It starts on ${reminderDayLabel(day)}, the day of your Strava reminder.`}
    </p>
  );
}
