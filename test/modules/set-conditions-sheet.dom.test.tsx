import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SetConditionsSheet } from "../../src/modules/runs/components/SetConditionsSheet";
import type { ConditionsActions } from "../../src/modules/runs/components/SetConditionsSheet";

/**
 * R2b's two picks (round 26, item 2), on the sheet itself — the parts the
 * run screens do not reach: the button naming only a whole pick, the
 * summary when both are missing, and the sentence a save leaves.
 */
function sheet(
  actions: Partial<ConditionsActions> = {},
  onDone: () => Promise<void> = () => Promise.resolve(),
) {
  return (
    <SetConditionsSheet
      runId="01RUN"
      units={{ temp: "f", distance: "mi" }}
      open
      onClose={vi.fn()}
      onDone={onDone}
      actions={{
        setConditions: actions.setConditions ?? (() => Promise.resolve(true)),
        retryWeather: actions.retryWeather ?? (() => Promise.resolve(true)),
      }}
    />
  );
}

async function openPicks(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog", {
    name: "No weather saved",
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Set conditions" }),
  );
  return screen.getByRole("dialog", { name: "Set conditions" });
}

describe("SetConditionsSheet: the picks", () => {
  it("names the pick on the button only once both halves are picked", async () => {
    const user = userEvent.setup();
    render(sheet());
    const dialog = await openPicks(user);

    await user.click(within(dialog).getByRole("radio", { name: "Rain" }));

    expect(
      within(dialog).getByRole("button", { name: "Set conditions" }),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("radio", { name: "41–50°" }));
    expect(
      within(dialog).getByRole("button", { name: "Set 41–50° and rain" }),
    ).toBeVisible();
  });

  it("lists both missing picks, by name, when neither was made", async () => {
    const user = userEvent.setup();
    render(sheet());
    const dialog = await openPicks(user);

    await user.click(
      within(dialog).getByRole("button", { name: "Set conditions" }),
    );

    expect(
      await within(dialog).findByText("2 fields need a fix."),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: /How warm/u }),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /^Sky/u })).toBeVisible();
  });

  it("says the conditions were set, and keeps the page where it is", async () => {
    const user = userEvent.setup();
    const submitted: SubmitEvent[] = [];
    const onSubmit = (event: SubmitEvent) => {
      submitted.push(event);
    };
    document.addEventListener("submit", onSubmit);
    // The caller's reload never finishes, so the sheet stays to be read.
    const onDone = vi.fn(async (): Promise<void> => {
      await Promise.withResolvers<undefined>().promise;
    });
    try {
      render(sheet({}, onDone));
      const dialog = await openPicks(user);
      await user.click(within(dialog).getByRole("radio", { name: "59–68°" }));
      await user.click(within(dialog).getByRole("radio", { name: "Dry" }));

      await user.click(
        within(dialog).getByRole("button", { name: "Set 59–68° and dry" }),
      );

      await waitFor(() => {
        expect(onDone).toHaveBeenCalledTimes(1);
      });
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        "Conditions set.",
      );
      expect(submitted.map((event) => event.defaultPrevented)).toEqual([true]);
    } finally {
      document.removeEventListener("submit", onSubmit);
    }
  });
});
