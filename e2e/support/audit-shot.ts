/**
 * The styling audit's screenshot hook (design 205). Off unless
 * `AUDIT_SHOTS` names a folder: then, every time the a11y fixture checks a
 * page, a screen state not seen before is shot at the phone and the desk,
 * light and dark, into `<AUDIT_SHOTS>/<route>/NN-<size>-<scheme>.png`, and
 * `index.jsonl` records which test reached it. The decisions are
 * `e2e/audit/shot-plan.ts`'s; this file only drives the page.
 *
 * The skill `styling-audit` says how to run a capture and read one.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import {
  describePart,
  indexLine,
  maxHeightFrom,
  routeOf,
  SHOT_ORDER,
  SHOT_SIZES,
  ShotLedger,
  shotHeight,
  shotName,
  slugOf,
  STATE_ATTRIBUTES,
  stateKey,
} from "../audit/shot-plan";

const DIRECTORY = process.env.AUDIT_SHOTS;
const MAX_HEIGHT = maxHeightFrom(process.env.AUDIT_MAX_HEIGHT);

/**
Whether a capture is running, and the test whose states are being shot.
*/
export const audit = { isShooting: false, title: "" };

/**
Read once per worker, on the first shot, from the folder's index.
*/
const run: { ledger?: ShotLedger } = {};

function ledgerFor(directory: string): ShotLedger {
  if (run.ledger === undefined) {
    mkdirSync(directory, { recursive: true });
    const index = path.join(directory, "index.jsonl");
    run.ledger = new ShotLedger(
      existsSync(index) ? readFileSync(index, "utf8") : "",
    );
  }
  return run.ledger;
}

/**
The z-index the e2e pointer marker uses; it is hidden while shooting.
*/
const MARKER_Z = "2147483647";

interface PageState {
  pathname: string;
  search: string;
  parts: {
    parent: string;
    tag: string;
    slot: string;
    states: [string, string][];
  }[];
}

/**
Runs in the page: every visible element, as the state key sees it.
*/
function readState(attributes: readonly string[]): PageState {
  const parts: PageState["parts"] = [];
  for (const element of document.body.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    const isHidden = style.display === "none" || style.visibility === "hidden";
    const isInsideIcon =
      element.tagName !== "svg" &&
      element.closest("script, style, svg") !== null;
    if (isHidden || isInsideIcon) continue;
    const data =
      element instanceof HTMLElement || element instanceof SVGElement
        ? element.dataset
        : undefined;
    parts.push({
      parent: element.parentElement?.tagName ?? "",
      tag: element.tagName,
      slot: data?.slot ?? data?.part ?? "",
      states: attributes
        .filter((name) => element.hasAttribute(name))
        .map((name): [string, string] => [
          name,
          element.getAttribute(name) ?? "",
        ]),
    });
  }
  return { pathname: location.pathname, search: location.search, parts };
}

async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let count = 0; count < 2; count += 1) {
      await new Promise<void>((resolve) => {
        globalThis.requestAnimationFrame(() => {
          resolve();
        });
      });
    }
  });
}

/**
Hides or shows the pointer marker; returns the document's height.
*/
async function markerVisibility(
  page: Page,
  visibility: "" | "hidden",
): Promise<number> {
  return page.evaluate(
    ({ z, value }) => {
      for (const element of globalThis.document.querySelectorAll<HTMLElement>(
        "body *",
      )) {
        if (element.style.zIndex === z) element.style.visibility = value;
      }
      return globalThis.document.documentElement.scrollHeight;
    },
    { z: MARKER_Z, value: visibility },
  );
}

async function shootAll(
  page: Page,
  folder: string,
  number: number,
): Promise<string[]> {
  const files: string[] = [];
  for (const shot of SHOT_ORDER) {
    const size = SHOT_SIZES[shot.size];
    await page.emulateMedia({ colorScheme: shot.scheme });
    await page.setViewportSize(size);
    await twoFrames(page);
    const tall = await markerVisibility(page, "hidden");
    const height = shotHeight(tall, size.height, MAX_HEIGHT);
    if (height !== size.height) {
      await page.setViewportSize({ width: size.width, height });
      await twoFrames(page);
    }
    const file = path.join(folder, shotName(number, shot));
    await page.screenshot({ path: file, animations: "disabled" });
    files.push(file);
  }
  return files;
}

async function restore(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  try {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize(viewport);
    await twoFrames(page);
    await markerVisibility(page, "");
  } catch {
    // The page closed under the shot; nothing is left to restore.
  }
}

function isSameOrigin(page: Page, appOrigin: string): boolean {
  try {
    return new URL(page.url()).origin === appOrigin;
  } catch {
    return false;
  }
}

/**
 * Shoots the page's current state if it is new. A no-op without
 * `AUDIT_SHOTS`, on another origin, or while a shot is already running.
 */
export async function auditShot(page: Page, appOrigin: string): Promise<void> {
  if (
    DIRECTORY === undefined ||
    DIRECTORY === "" ||
    audit.isShooting ||
    page.isClosed() ||
    !isSameOrigin(page, appOrigin)
  )
    return;
  audit.isShooting = true;
  const viewport = page.viewportSize() ?? SHOT_SIZES.desk;
  try {
    const state = await page.evaluate(readState, STATE_ATTRIBUTES);
    const route = routeOf(state.pathname, state.search);
    const key = stateKey(
      route,
      state.parts.map((part) => describePart(part)),
    );
    const number = ledgerFor(DIRECTORY).claim(route, key);
    if (number === undefined) return;
    const folder = path.join(DIRECTORY, slugOf(route));
    mkdirSync(folder, { recursive: true });
    const files = await shootAll(page, folder, number);
    appendFileSync(
      path.join(DIRECTORY, "index.jsonl"),
      indexLine({
        key,
        route,
        url: page.url(),
        test: audit.title,
        width: viewport.width,
        files,
      }),
    );
  } catch {
    // The page navigated or closed under the shot; the next state is taken.
  } finally {
    await restore(page, viewport);
    audit.isShooting = false;
  }
}
