import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { useIdempotencyKey } from "../../src/ui";

/**
 * One key per composed submission (CLAUDE.md law 8b).
 *
 * The whole point is a lifetime, and a lifetime is not something a type
 * can hold: the key has to survive a re-render and a failed attempt, and
 * has to change when the caller says a save landed. Nothing tested it —
 * `src/ui/**\/*.ts` was outside the mutation ratchet, so the hook that
 * decides whether a double-click becomes two runs had no assertions at
 * all.
 */

function Probe() {
  const { idempotencyKey, rotate } = useIdempotencyKey();
  // A click here must actually cause a re-render, or the "keeps the same
  // key across re-renders" test below is clicking a button that does
  // nothing and passing regardless of whether the hook mints a fresh
  // `useState` value on every render.
  const [, triggerRerender] = useState(0);
  return (
    <div>
      <output>{idempotencyKey}</output>
      <button type="button" onClick={rotate}>
        Rotate
      </button>
      <button
        type="button"
        onClick={() => {
          triggerRerender((count) => count + 1);
        }}
      >
        Re-render
      </button>
    </div>
  );
}

function key(): string {
  return screen.getByRole("status").textContent;
}

describe("useIdempotencyKey", () => {
  it("mints a key on mount", () => {
    render(<Probe />);

    // A ULID, not an empty string: the server's UNIQUE index is scoped to
    // the user, so a blank key would collide with every other blank one
    // and the second genuine save would silently return the first's row.
    expect(key()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("keeps the same key across re-renders", () => {
    // What this pins is the lifetime, not the initializer's shape. React
    // discards `useState`'s argument after the first render, so
    // `useState(newUlid())` keeps the key too — it just mints a ULID on
    // every render and throws it away, which is waste rather than a bug.
    // (Checked, rather than assumed: this test passes against that form.)
    //
    // What it does rule out is the key changing underneath a submission —
    // a `newUlid()` read during render, or a rotate in an effect. The
    // retry of a failed submit has to carry the same key or the server
    // sees a fresh request, which is the duplicate this hook exists to
    // prevent.
    render(<Probe />);
    const first = key();

    // Any state change is enough to re-render.
    screen.getByRole("button", { name: "Re-render" }).click();

    expect(key()).toBe(first);
  });

  it("gives a new key when the caller rotates", async () => {
    // After a save that landed, so a genuine second save on the same mount
    // is not read as a replay of the first.
    const user = userEvent.setup();
    render(<Probe />);
    const first = key();

    await user.click(screen.getByRole("button", { name: "Rotate" }));

    expect(key()).not.toBe(first);
    expect(key()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("keeps rotating, rather than alternating between two", async () => {
    const user = userEvent.setup();
    render(<Probe />);
    const seen = new Set([key()]);

    await user.click(screen.getByRole("button", { name: "Rotate" }));
    seen.add(key());
    await user.click(screen.getByRole("button", { name: "Rotate" }));
    seen.add(key());

    expect(seen.size).toBe(3);
  });
});
