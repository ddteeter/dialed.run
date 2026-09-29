import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AccountClosed,
  APPEAL_ADDRESS,
} from "../../src/modules/safety/components/AccountClosed";

/**
 * Operator Screens D4: what a banned runner opens to. Its promises are
 * copy, so the copy is what is asserted — the reason word for word, the
 * date, the way to appeal, and nothing to press.
 */
describe("D4 · the notice", () => {
  // 16 September 2026, 08:06 UTC.
  const closedAt = Date.UTC(2026, 8, 16, 8, 6) / 1000;
  const reason =
    "Three separate entries this week were adverts for a supplement store.";

  it("says the account is closed, when, and why, in the operator's words", () => {
    render(<AccountClosed reason={reason} closedAt={closedAt} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Your account is closed.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "A person at dialed.run closed it on September 16. This is the reason they wrote down:",
      ),
    ).toBeTruthy();
    expect(screen.getByText(reason).tagName).toBe("BLOCKQUOTE");
    expect(
      screen.getByText(
        "Your entries and photos are no longer public. Your sign-in no longer works.",
      ),
    ).toBeTruthy();
  });

  it("dates the ban in UTC, whatever the hour", () => {
    // 23:30 UTC on the 16th is still the 16th — not the 17th somewhere
    // east, which is where a device zone would put it.
    const late = Date.UTC(2026, 8, 16, 23, 30) / 1000;
    render(<AccountClosed reason={reason} closedAt={late} />);
    expect(screen.getByText(/closed it on September 16\./)).toBeTruthy();
  });

  it("gives the appeal address as a link and offers nothing to press", () => {
    render(<AccountClosed reason={reason} closedAt={closedAt} />);
    const link = screen.getByRole("link", { name: APPEAL_ADDRESS });
    expect(link.getAttribute("href")).toBe("mailto:desk@dialed.run");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/A person reads every message\./)).toBeTruthy();
    // The word before the link and the address itself are separate text
    // nodes either side of the `<a>`, so a missing space between them reads
    // fine as two `getByText` matches and wrong as continuous prose.
    expect(link.parentElement?.textContent).toBe(
      `If you think this is wrong, write to ${APPEAL_ADDRESS}. A person reads every message.`,
    );
  });

  it("promises no time to an answer (D-73)", () => {
    render(<AccountClosed reason={reason} closedAt={closedAt} />);
    const appeal = screen.getByRole("link", { name: APPEAL_ADDRESS })
      .parentElement?.textContent;
    expect(appeal).not.toMatch(/within|week|\bdays?\b/u);
  });

  it("draws the plain lockup, with no pink brackets", () => {
    const { container } = render(
      <AccountClosed reason={reason} closedAt={closedAt} />,
    );
    expect(container.textContent).not.toContain("[dialed");
  });
});
