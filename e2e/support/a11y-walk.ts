/**
 * The in-page half of the end-of-test checks (plan 161, step 2),
 * serialized into every app page by `addInitScript` beside
 * `a11y-page.ts`'s checker, whose `__a11yDescribe` names the elements.
 *
 * Node presses Tab and calls `__a11yWalk.step()` after each press; the
 * page keeps what was reached and measures each stop. Everything here
 * must live inside `installWalk`: Playwright sends its source, not its
 * closure.
 */

import type { PageFinding } from "./a11y-page";

/**
 * What the page hands back: where it is, and what it found there.
 */
export type PageReport = Readonly<{
  url: string;
  findings: readonly PageFinding[];
}>;

interface Walk {
  /**
  Lists the controls and returns how many Tab presses to allow.
  */
  start: () => number;
  /**
  Measures where focus is now; true once the walk is back at its start.
  */
  step: () => boolean;
  /**
  What the walk found, `isCut` when the press cap ran out first.
  */
  finish: (isCut: boolean) => PageReport;
  /**
  Whether the page scrolls sideways, and what makes it.
  */
  reflow: () => PageReport;
}

declare global {
  var __a11yWalk: Walk | undefined;
}

export function installWalk(origin: string): void {
  if (location.origin !== origin) return;

  const NATIVE =
    "a[href], button, input:not([type=hidden]), select, textarea, summary";

  const ROLES =
    "[role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=option], [role=combobox], [role=slider], [role=textbox], [role=searchbox], [role=spinbutton]";

  /*
   * A composite widget moves focus inside itself with the arrow keys
   * (roving tabindex), so Tab reaches one member and that is the group.
   */
  const COMPOSITE =
    "[role=tablist], [role=radiogroup], [role=toolbar], [role=listbox], [role=menu], [role=menubar], [role=grid], [role=tree]";

  /*
   * How long the walk may sit on an iframe. Tab moves inside the frame's
   * own document, so the parent sees the same element for each control
   * in it (Turnstile's widget is one).
   */
  const FRAME_PRESSES = 30;

  const name = (element: Element): string =>
    globalThis.__a11yDescribe?.(element) ?? element.tagName.toLowerCase();

  const finding = (rule: string, element: Element): PageFinding => ({
    rule,
    node: name(element),
  });

  const state = {
    controls: [] as Element[],
    reached: new Set<Element>(),
    findings: [] as PageFinding[],
    first: undefined as Element | undefined,
    last: undefined as Element | undefined,
    frameRun: 0,
    bodyRun: 0,
    isTrapped: false,
  };

  const geometry = {
    /**
    Drawn at all: a visually hidden proxy (`sr-only`) is not.
    */
    isDrawn(element: Element): boolean {
      const box = element.getBoundingClientRect();
      return box.width > 1 && box.height > 1;
    },

    /**
    Some point of the element is on top: it, or something inside it.
    */
    isUncovered(element: Element): boolean {
      const box = element.getBoundingClientRect();
      const inset = Math.min(2, box.width / 4, box.height / 4);
      const points = [
        [box.left + box.width / 2, box.top + box.height / 2],
        [box.left + inset, box.top + inset],
        [box.right - inset, box.top + inset],
        [box.left + inset, box.bottom - inset],
        [box.right - inset, box.bottom - inset],
      ];
      return points.some(([x = 0, y = 0]) => {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
          return false;
        }
        const hit = document.elementFromPoint(x, y);
        return hit !== null && (element.contains(hit) || hit.contains(element));
      });
    },

    /*
     * Inside a box that scrolls or clips on its own, which keeps the page
     * from scrolling sideways (and reflow allows it).
     */
    isContained(element: Element): boolean {
      for (
        let parent = element.parentElement;
        parent !== null && parent !== document.body;
        parent = parent.parentElement
      ) {
        if (getComputedStyle(parent).overflowX !== "visible") return true;
      }
      return false;
    },

    hasRing(element: Element): boolean {
      const style = getComputedStyle(element);
      return (
        style.outlineStyle !== "none" &&
        Number(style.outlineWidth.replace("px", "")) >= 2 &&
        !/^(?:transparent|rgba\(.*,\s*0\))$/u.test(style.outlineColor)
      );
    },

    /*
     * Where a ring may be drawn for a focused element: on it, on its
     * labels, on the next sibling (Tailwind's `peer-focus-visible`), or on
     * an ancestor that draws it for the control inside (`.field-box`).
     */
    ringOwners(element: Element): Element[] {
      const labels =
        element instanceof HTMLInputElement && element.labels !== null
          ? [...element.labels]
          : [];
      const owners = [element, ...labels];
      if (element.nextElementSibling !== null) {
        owners.push(element.nextElementSibling);
      }
      let parent = element.parentElement;
      for (let level = 0; parent !== null && level < 3; level += 1) {
        owners.push(parent);
        parent = parent.parentElement;
      }
      return owners;
    },
  };

  const controls = {
    /**
    Out of reach on purpose: disabled, inert, hidden from everyone.
    */
    isExempt(element: Element): boolean {
      return (
        element.matches(":disabled") ||
        element.closest("[inert], [aria-hidden=true]") !== null ||
        !element.checkVisibility({ visibilityProperty: true }) ||
        !geometry.isDrawn(element)
      );
    },

    /*
     * Drawn as clickable and nothing else says so: `cursor: pointer` on
     * an element that is not a control, not inside or around one, and
     * not a label. Only where the pointer starts, since it is inherited.
     */
    isClickableBox(element: Element): boolean {
      const style = getComputedStyle(element);
      if (style.cursor !== "pointer") return false;
      const parent = element.parentElement;
      if (parent !== null && getComputedStyle(parent).cursor === "pointer") {
        return false;
      }
      const control = `${NATIVE}, ${ROLES}, label, [tabindex]`;
      return (
        element.closest(control) === null &&
        element.querySelector(control) === null
      );
    },

    list(scope: Element | Document): Element[] {
      const named = [
        ...scope.querySelectorAll(`${NATIVE}, ${ROLES}, [tabindex]`),
      ].filter(
        (element) =>
          element.matches(`${NATIVE}, ${ROLES}`) ||
          (element instanceof HTMLElement && element.tabIndex >= 0),
      );
      const clickable = [...scope.querySelectorAll("*")].filter((element) =>
        controls.isClickableBox(element),
      );
      return [...named, ...clickable].filter(
        (element) => !controls.isExempt(element),
      );
    },

    /**
    One radio group or composite widget, or the element alone.
    */
    groupOf(element: Element): Element {
      if (element instanceof HTMLInputElement && element.type === "radio") {
        const named = `input[type=radio][name="${CSS.escape(element.name)}"]`;
        return (element.form ?? document).querySelector(named) ?? element;
      }
      return element.closest(COMPOSITE) ?? element;
    },

    unreached(): Element[] {
      const reachedGroups = new Set(
        [...state.reached].map((element) => controls.groupOf(element)),
      );
      return state.controls.filter(
        (element) =>
          !state.reached.has(element) &&
          !reachedGroups.has(controls.groupOf(element)),
      );
    },
  };

  const stops = {
    measure(element: Element): void {
      state.reached.add(element);
      if (element.tagName === "IFRAME") return;
      const owners = geometry.ringOwners(element);
      if (owners.every((owner) => !geometry.hasRing(owner))) {
        state.findings.push(finding("focus-ring", element));
      }
      const shown = geometry.isDrawn(element)
        ? [element]
        : owners.slice(1).filter((owner) => geometry.isDrawn(owner));
      if (shown.every((owner) => !geometry.isUncovered(owner))) {
        state.findings.push(finding("focus-obscured", element));
      }
    },

    /**
    Focus on the page itself: true after two in a row, an empty page.
    */
    onBody(): boolean {
      state.bodyRun += 1;
      state.last = undefined;
      return state.first === undefined && state.bodyRun > 1;
    },

    /**
    Focus did not move. In a frame that is the frame's own walk.
    */
    isStuck(active: Element): boolean {
      if (active !== state.last) {
        state.frameRun = 0;
        return false;
      }
      if (active.tagName !== "IFRAME") return true;
      state.frameRun += 1;
      return state.frameRun > FRAME_PRESSES;
    },
  };

  const bridge = globalThis;
  bridge.__a11yWalk = {
    start() {
      const modal = document.querySelector("dialog:modal");
      state.controls = controls.list(modal ?? document);
      for (const element of state.controls) {
        if (element instanceof HTMLElement && element.tabIndex > 0) {
          state.findings.push(finding("tab-order", element));
        }
      }
      return Math.min(2 * state.controls.length + 10, 400);
    },

    step() {
      const active = document.activeElement;
      if (active === null || active === document.body) return stops.onBody();
      state.bodyRun = 0;
      if (stops.isStuck(active)) {
        state.isTrapped = true;
        return true;
      }
      if (active === state.last) return false;
      state.last = active;
      if (active === state.first) return true;
      state.first ??= active;
      stops.measure(active);
      return false;
    },

    finish(isCut) {
      const trap = state.last ?? document.body;
      if (isCut || state.isTrapped) {
        state.findings.push(finding("focus-trap", trap));
      }
      const unreached = controls
        .unreached()
        .map((element) => finding("tab-unreached", element));
      return {
        url: location.pathname,
        findings: [...state.findings, ...unreached],
      };
    },

    reflow() {
      const width = document.documentElement.clientWidth;
      const report = { url: location.pathname, findings: [] as PageFinding[] };
      if (document.documentElement.scrollWidth <= width) return report;
      const starts = [...document.body.querySelectorAll("*")].filter(
        (element) => {
          const right = element.getBoundingClientRect().right;
          const parent = element.parentElement?.getBoundingClientRect().right;
          return (
            right > width + 1 &&
            (parent === undefined || parent <= width + 1) &&
            !geometry.isContained(element)
          );
        },
      );
      const found = starts.length === 0 ? [document.documentElement] : starts;
      report.findings = found.map((element) => finding("reflow", element));
      return report;
    },
  };
}
