import { afterEach, describe, expect, it } from "vitest";

import { enforcedPolicy } from "../../src/modules/ops/edge/security-headers";

/**
 * What Chromium does with the policy the app enforces (SA-M40, design
 * 228): a page under it reaches its own origin and nothing else, so no
 * library the page loads sends anything off the app.
 *
 * `test/ops/security-headers.test.ts` pins the header and its value. This
 * pins that a browser given that value refuses the connection, which no
 * other project can show: workerd and happy-dom apply no policy.
 *
 * The policy reaches a framed document as a `<meta>`, the one way a page
 * with no server of its own can take one. `frame-ancestors` is left out:
 * a `<meta>` policy ignores it, and says so in the console.
 */
function policyForMeta(): string {
  return enforcedPolicy()
    .split("; ")
    .filter((directive) => !directive.startsWith("frame-ancestors "))
    .join("; ");
}

/**
 * A same-origin framed document under the app's enforced policy.
 */
async function pageUnderPolicy(): Promise<Window> {
  const frame = document.createElement("iframe");
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policyForMeta()}"><title>under policy</title>`;
  const loaded = new Promise((resolve) => {
    frame.addEventListener("load", resolve, { once: true });
  });
  // `insertAdjacentElement` because the Workers types' `Element.append`
  // (HTMLRewriter's) shadows the DOM's for tsc.
  document.body.insertAdjacentElement("beforeend", frame);
  await loaded;
  if (frame.contentWindow === null) throw new Error("the frame has no window");
  return frame.contentWindow;
}

async function outcomeOf(
  request: Promise<Response>,
): Promise<"answered" | "refused"> {
  try {
    await request;
    return "answered";
  } catch {
    return "refused";
  }
}

afterEach(() => {
  for (const frame of document.querySelectorAll("iframe")) frame.remove();
});

describe("the enforced policy in Chromium", () => {
  it("still names connect-src 'self'", () => {
    expect(policyForMeta().split("; ")).toContain("connect-src 'self'");
  });

  it("refuses a request to another origin, and names the directive that did", async () => {
    const page = await pageUnderPolicy();
    const refused = new Promise<SecurityPolicyViolationEvent>((resolve) => {
      page.document.addEventListener("securitypolicyviolation", resolve, {
        once: true,
      });
    });

    // A reserved name: were the policy not applied, nothing would answer
    // either, so the violation below is what tells the two apart.
    expect(
      await outcomeOf(
        page.fetch("https://elsewhere.example/v1/log", {
          method: "POST",
          body: "x",
        }),
      ),
    ).toBe("refused");

    const violation = await refused;
    expect(violation.effectiveDirective).toBe("connect-src");
    expect(violation.disposition).toBe("enforce");
    expect(violation.blockedURI).toBe("https://elsewhere.example/v1/log");
  });

  it("lets the page reach its own origin", async () => {
    const page = await pageUnderPolicy();

    const response = await page.fetch(
      `${location.origin}/mediapipe/blaze_face_short_range.tflite`,
      { method: "HEAD" },
    );

    expect(response.status).toBe(200);
  });
});
