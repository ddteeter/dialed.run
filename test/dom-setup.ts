/**
 * Setup for the `ui` project (jsdom). `@testing-library/jest-dom` adds the
 * accessibility-shaped matchers the forms contract is written in —
 * `toHaveAccessibleDescription`, `toHaveFocus`, `toBeVisible` — and the
 * cleanup unmounts between tests so one test's DOM cannot answer another's
 * query.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
