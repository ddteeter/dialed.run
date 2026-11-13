import { onTestFinished, vi } from "vitest";

import { DESK_MEDIA_QUERY } from "../../src/ui/DeskDetail";

/**
 * The window, as the desk query reads it: `desk` (≥1040) or not, and a
 * way to resize it across the line. happy-dom's own window is 1024 wide,
 * just under desk, so a test of the pane beside the table says it is at
 * desk. Unstubbed when the test ends.
 */
export function atWidth(isDesk: boolean): {
  resize: (isDesk: boolean) => void;
  /**
  How many are listening for the window crossing desk.
  */
  listening: () => number;
} {
  const listeners = new Set<() => void>();
  const query = {
    matches: isDesk,
    // Only "change" is ever sent, so only it is heard.
    addEventListener: (type: string, listener: () => void) => {
      if (type === "change") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === "change") listeners.delete(listener);
    },
  };
  vi.stubGlobal(
    "matchMedia",
    // Any other query (reduced motion, say) is simply not matched.
    vi.fn((asked: string) =>
      asked === DESK_MEDIA_QUERY ? query : { ...query, matches: false },
    ),
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  return {
    resize: (isNowDesk) => {
      query.matches = isNowDesk;
      for (const listener of listeners) listener();
    },
    listening: () => listeners.size,
  };
}
