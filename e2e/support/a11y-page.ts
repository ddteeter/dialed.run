/**
 * The in-page half of the a11y fixture (plan 161), serialized into every
 * app page by `addInitScript`.
 *
 * Everything `installChecker` uses must live inside it: Playwright sends
 * the function's source, not its closure. The types around it are
 * compile-time only.
 */

/**
 * One problem on one element, as the page reports it. `rule` is an axe
 * rule id, or one of this checker's own: `target-44` and `name-space`.
 */
export interface PageFinding {
  readonly rule: string;
  readonly node: string;
}

/**
 * One checked state.
 */
export interface CheckReport {
  readonly key: string;
  readonly url: string;
  readonly ms: number;
  readonly findings: readonly PageFinding[];
}

export interface CheckerOptions {
  readonly origin: string;
  readonly rules: readonly string[];
  readonly minTarget: number;
}

/**
 * The slice of axe-core's API the checker calls.
 */
interface Axe {
  run: (
    context: Document,
    runOptions: unknown,
  ) => Promise<{
    violations: { id: string; nodes: { html: string; target: unknown[] }[] }[];
  }>;
}

declare global {
  var hasA11yChecked: (key: string) => Promise<boolean>;
  var __a11yReport: (report: CheckReport) => Promise<void>;
  var __a11yError: (message: string) => Promise<void>;
  var __a11yCheck: (() => Promise<void>) | undefined;
  var axe: Axe | undefined;
}

export function installChecker(options: CheckerOptions): void {
  if (location.origin !== options.origin) return;

  const INTERACTIVE =
    "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [tabindex]:not([tabindex='-1'])";

  /*
   * Elements whose accessible name is built from their content, which is
   * where a dropped space changes what is said.
   */
  const NAMED_FROM_CONTENT =
    "h1, h2, h3, h4, h5, h6, a[href], button, label, legend, option, th, [role=button], [role=link], [role=tab], [role=heading]";

  /*
   * The helpers are methods of one object, not functions of their own:
   * they must stay inside `installChecker` to be serialized with it.
   */
  const dom = {
    /*
     * The area that takes the click: the element, its labels, and a
     * `::before` drawn proud of it (`target-seam` in `a11y.css`: a 32px
     * chip whose pseudo-element makes the target 44).
     */
    hitBox(element: Element): DOMRect | undefined {
      const box = element.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) return undefined;
      const parts = [box, dom.pseudoBox(element, box)];
      if (element instanceof HTMLInputElement && element.labels !== null) {
        parts.push(
          ...[...element.labels].map((label) => label.getBoundingClientRect()),
        );
      }
      const left = Math.min(...parts.map((part) => part.left));
      const top = Math.min(...parts.map((part) => part.top));
      const right = Math.max(...parts.map((part) => part.right));
      const bottom = Math.max(...parts.map((part) => part.bottom));
      return new DOMRect(left, top, right - left, bottom - top);
    },

    /*
     * An absolutely placed `::before` with insets, as the box it covers.
     * A negative inset is the edge moved outward: `inset: -6px 0` on a
     * 32px chip covers 44.
     * Anything else adds nothing, so it returns the element's own box.
     */
    pseudoBox(element: Element, box: DOMRect): DOMRect {
      const pseudo = getComputedStyle(element, "::before");
      if (pseudo.content === "none" || pseudo.position !== "absolute") {
        return box;
      }
      const inset = (side: string) =>
        Number(pseudo.getPropertyValue(side).replace("px", "")) || 0;
      return new DOMRect(
        box.left + inset("left"),
        box.top + inset("top"),
        box.width - inset("left") - inset("right"),
        box.height - inset("top") - inset("bottom"),
      );
    },

    /*
     * WCAG 2.5.8's inline exception: a link inside a sentence is sized by
     * the line it sits in.
     */
    isInlineInText(element: Element): boolean {
      // The app marks the links it reads as inline (`a11y.css` §03).
      if (
        element instanceof HTMLElement &&
        element.dataset.target === "inline"
      ) {
        return true;
      }
      if (getComputedStyle(element).display !== "inline") return false;
      const siblings = element.parentElement?.childNodes ?? [];
      return [...siblings].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE &&
          (node.textContent ?? "").trim() !== "",
      );
    },

    /*
     * A space that is a text node of its own, between two other text
     * nodes (React's `{count} {title}`), is drawn but left out of the
     * accessible name by Chromium: "7 waiting" is announced "7waiting".
     */
    isStrandedSpace(node: Node): boolean {
      if (node.nodeType !== Node.TEXT_NODE) return false;
      if ((node.textContent ?? "").trim() !== "") return false;
      const beside = (step: "previousSibling" | "nextSibling") => {
        let other = node[step];
        while (other !== null && other.nodeType === Node.COMMENT_NODE) {
          other = other[step];
        }
        return other?.nodeType;
      };
      return (
        beside("previousSibling") === Node.TEXT_NODE &&
        beside("nextSibling") === Node.TEXT_NODE
      );
    },

    /*
     * An element by what stays put between runs and between the dev and
     * built servers: its tag and its naming attributes, never its markup
     * (the dev server adds `data-tsd-source`, and axe cuts long markup at
     * different points). An element with none of them is named by its
     * first class under its nearest `data-part`/`data-slot` ancestor.
     */
    describe(element: Element): string {
      const NAMING = [
        "data-slot",
        "data-part",
        "name",
        "type",
        "role",
        "aria-label",
        "href",
      ];
      const own = NAMING.filter((attribute) => element.hasAttribute(attribute))
        .map(
          (attribute) =>
            `[${attribute}="${element.getAttribute(attribute) ?? ""}"]`,
        )
        .join("");
      const tag = element.tagName.toLowerCase();
      if (own !== "") return `${tag}${own}`;
      const anchor = element.parentElement?.closest("[data-part], [data-slot]");
      const scope =
        anchor === null || anchor === undefined
          ? ""
          : `${dom.describe(anchor)} `;
      const first = element.classList[0];
      const kind = first === undefined ? tag : `${tag}.${first}`;
      return `${scope}${kind}`;
    },

    nodeOf(target: unknown[], html: string): string {
      const selector = target[0];
      const element =
        typeof selector === "string"
          ? (document.querySelector(selector) ?? undefined)
          : undefined;
      return element === undefined ? html.slice(0, 120) : dom.describe(element);
    },

    hasStrandedSpace(element: Element): boolean {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null;) {
        if (dom.isStrandedSpace(node)) return true;
        node = walker.nextNode();
      }
      return false;
    },
  };

  function smallTargets(): PageFinding[] {
    const found: PageFinding[] = [];
    for (const element of document.querySelectorAll(INTERACTIVE)) {
      const box = dom.hitBox(element);
      if (box === undefined || dom.isInlineInText(element)) continue;
      if (box.width < options.minTarget || box.height < options.minTarget) {
        found.push({ rule: "target-44", node: dom.describe(element) });
      }
    }
    return found;
  }

  function strandedSpaces(): PageFinding[] {
    return [...document.querySelectorAll(NAMED_FROM_CONTENT)]
      .filter((element) => dom.hasStrandedSpace(element))
      .map((element) => ({ rule: "name-space", node: dom.describe(element) }));
  }

  async function stateKey(): Promise<string> {
    // SHA-1 of the markup: a dedupe key, not a security boundary.
    const digest = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(document.body.getHTML()),
    );
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `${String(innerWidth)}:${hex}`;
  }

  /*
   * Lets running animations finish first, capped at a second: a tile
   * caught mid-move overlaps its neighbour, and axe's `target-size` then
   * reports a screen that never stands still that way. A looping
   * animation (the breathing brackets) never finishes, hence the cap.
   */
  async function settled(): Promise<void> {
    const finishing = document
      .getAnimations()
      .filter(
        (animation) => animation.effect?.getTiming().iterations !== Infinity,
      )
      .map((animation) => animation.finished);
    await Promise.race([
      Promise.allSettled(finishing),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }

  async function check(): Promise<void> {
    const axe = globalThis.axe;
    if (axe === undefined) return;
    await settled();
    const key = await stateKey();
    if (await globalThis.hasA11yChecked(key)) return;
    const started = performance.now();
    const result = await axe.run(document, {
      runOnly: { type: "rule", values: options.rules },
    });
    const findings = result.violations.flatMap((violation) =>
      violation.nodes.map((node) => ({
        rule: violation.id,
        node: dom.nodeOf(node.target, node.html),
      })),
    );
    await globalThis.__a11yReport({
      key,
      url: location.pathname,
      ms: Math.round(performance.now() - started),
      findings: [...findings, ...smallTargets(), ...strandedSpaces()],
    });
  }

  /*
   * axe refuses to start while it is running, and a spec can fire two
   * actions at once (`Promise.all([waitForURL, click])`), so a second
   * check waits for the first.
   */
  let running: Promise<void> = Promise.resolve();
  const bridge = globalThis;
  bridge.__a11yCheck = async () => {
    const previous = running;
    running = (async () => {
      await previous;
      try {
        await check();
      } catch (error) {
        await globalThis.__a11yError(String(error));
      }
    })();
    await running;
  };
}
