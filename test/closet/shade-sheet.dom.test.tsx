import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

import {
  sampleFromTarget,
  ShadeSheet,
} from "../../src/modules/closet/components/ShadeSheet";

/**
 * The shared real context, to restore when this file is done with it.
 */
const sharedGetContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  "getContext",
) ?? { configurable: true };

/**
 * The real API answers `null` for a context it cannot give, and
 * `unicorn/no-null` forbids writing the literal — so it is parsed, the way
 * `test/modules/closet-fixtures.ts` already does for a D1 row's nulls.
 */
const NO_CONTEXT = z.null().parse(JSON.parse("null"));

// A 2×2 photo, one colour per quadrant, so a tap tells left from right
// *and* top from bottom — a 2×1 fixture cannot see a mistake in y.
const QUADRANTS = [
  [255, 0, 0, 255],
  [0, 0, 255, 255],
  [0, 255, 0, 255],
  [255, 255, 0, 255],
];

/**
 * Held on an object so the stub sets a property rather than reassigning a
 * module-level binding, which `unicorn/no-top-level-assignment-in-function`
 * rules out.
 */
const canvas = { hasDrawn: false };

const fakeContext: Partial<CanvasRenderingContext2D> = {
  // Reading before drawing gives transparent black on a real canvas, so
  // the stub does the same — that is what makes the drawImage call
  // observable rather than decoration.
  drawImage: () => {
    canvas.hasDrawn = true;
  },
  getImageData: (x: number, y: number) => ({
    data: Uint8ClampedArray.from(
      canvas.hasDrawn ? (QUADRANTS[y * 2 + x] ?? [0, 0, 0, 0]) : [0, 0, 0, 0],
    ),
    colorSpace: "srgb",
    width: 1,
    height: 1,
  }),
};

/**
 * `defineProperty` rather than an assignment, because the real signature is
 * six overloads and a stub cannot satisfy it without a cast — and a cast
 * here would be the one place this repo's parse-don't-cast rule got waved
 * through for convenience.
 */
function installContext(give: (id: string) => unknown) {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: give,
  });
}

/**
 * Only "2d" answers, like the real one: another id is another context.
 */
const canvasStub = (id: string) => (id === "2d" ? fakeContext : NO_CONTEXT);

/**
 * `<dialog>` needs no shim: the project picked happy-dom precisely because
 * it implements `showModal`, which `ui/Sheet` is built on (vitest.config.ts
 * says so).
 *
 * The canvas is the other way round. `test/dom-setup.ts` already installs a
 * **real** node-canvas 2d context, and it is real enough that this file
 * would rather use it — but `drawImage` needs a decoded bitmap, and the
 * `<img>` happy-dom hands it never fetches or decodes anything. So the
 * pixels are stubbed and nothing else is: which pixel gets read, and what
 * the sheet does with the answer, are the decisions under test and they are
 * all above that line. The shared context is put back afterwards.
 */
beforeAll(() => {
  installContext(canvasStub);
});

afterAll(() => {
  Object.defineProperty(
    HTMLCanvasElement.prototype,
    "getContext",
    sharedGetContext,
  );
});

beforeEach(() => {
  canvas.hasDrawn = false;
  installContext(canvasStub);
});

/**
 * A tap at a fraction of the way across the sampler.
 *
 * `getBoundingClientRect` answers zeroes in happy-dom, so the box the
 * handler measures against is stubbed per click — the fraction is the
 * input to the code under test, and a zero-width box would make every tap
 * land at NaN.
 */
const BOX = { left: 40, top: 80, width: 100, height: 100 };

async function tapPhoto(fractionX: number, fractionY = 0.25) {
  // `getByAltText` is typed `HTMLElement`; the natural dimensions live on
  // `HTMLImageElement`, so the element is re-found as one rather than
  // asserted into one.
  const photo = screen
    .getByAltText(/tap to sample a shade from your photo/i)
    .closest("img");
  const target = photo?.closest("button");
  if (photo === null || target === undefined || target === null) {
    throw new Error("the sampler is not an image inside a button");
  }
  vi.spyOn(photo, "naturalWidth", "get").mockReturnValue(2);
  vi.spyOn(photo, "naturalHeight", "get").mockReturnValue(2);
  // Deliberately not at the origin: with left/top of 0, adding the offset
  // and subtracting it give the same answer, so a sign error is invisible.
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    ...BOX,
    right: BOX.left + BOX.width,
    bottom: BOX.top + BOX.height,
    x: BOX.left,
    y: BOX.top,
    toJSON: () => BOX,
  });
  await userEvent.pointer({
    target,
    keys: "[MouseLeft]",
    coords: {
      clientX: BOX.left + fractionX * BOX.width,
      clientY: BOX.top + fractionY * BOX.height,
    },
  });
}

const props = {
  open: true,
  colorName: "Navy",
  value: "",
  onUse: vi.fn(),
  onClear: vi.fn(),
  onClose: vi.fn(),
};

describe("ShadeSheet (design round 11 §AH2)", () => {
  it("names the level-1 choice it was opened from, and says it is optional", () => {
    // Level 2 is reached from a chosen name, so the sheet says which one —
    // a hex with no name is a fidelity the Call's rule has no use for.
    render(<ShadeSheet {...props} />);
    expect(screen.getByText("Navy · optional")).toBeVisible();
  });

  it("shows the swatch only once the hex is a real one", async () => {
    // The 18px square is the runner checking their own reading, so it must
    // never show a colour that is not what the field says. A partial
    // "#1f2a" is not a colour yet.
    const user = userEvent.setup();
    const { container } = render(<ShadeSheet {...props} />);
    const swatch = () => container.querySelector("[data-swatch]");

    expect(swatch()).toHaveAttribute("data-swatch", "transparent");
    await user.type(screen.getByLabelText("Hex"), "#1f2a");
    expect(swatch()).toHaveAttribute("data-swatch", "transparent");
    await user.type(screen.getByLabelText("Hex"), "44");
    expect(swatch()).toHaveAttribute("data-swatch", "#1f2a44");
  });

  it("draws the swatch at the one size design asked for, in the sampled colour", () => {
    // 18px "because design said 18px", and it is the only swatch in the
    // product — so what it shows has to be exactly what the field says.
    const { container } = render(<ShadeSheet {...props} value="#1f2a44" />);
    const swatch = container.querySelector("[data-swatch]");

    expect(swatch).toHaveStyle({ width: "18px", height: "18px" });
    expect(swatch).toHaveStyle({ backgroundColor: "#1f2a44" });
  });

  it("shows nothing through the swatch while the hex is unreadable", () => {
    // Transparent, not a colour: a square showing something the field does
    // not say is the one thing this element must never do.
    const { container } = render(<ShadeSheet {...props} value="nope" />);

    const swatch = container.querySelector("[data-swatch]");
    expect(swatch).toHaveAttribute("data-swatch", "transparent");
    expect(swatch).toHaveStyle({ backgroundColor: "transparent" });
  });

  it("accepts a hex pasted with spaces around it", () => {
    // The field takes a paste as readily as a sample, and a copied swatch
    // value often brings whitespace with it.
    render(<ShadeSheet {...props} value="  #1F2A44  " />);
    expect(
      screen.getByRole("button", { name: "Use this" }),
    ).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/six-digit hex/)).toBeNull();
  });

  it("treats a field of only spaces as empty, not as wrong", () => {
    render(<ShadeSheet {...props} value="   " />);
    expect(screen.queryByText(/six-digit hex/)).toBeNull();
  });

  it("hides the swatch from assistive tech — the hex beside it is the value", () => {
    const { container } = render(<ShadeSheet {...props} value="#1f2a44" />);
    expect(container.querySelector("[data-swatch]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("says what is wrong in the schema's own words, and not while empty", async () => {
    // Error copy lives in the schema (§Forms & failure). An empty field is
    // not an error — the whole level is optional.
    const user = userEvent.setup();
    render(<ShadeSheet {...props} />);

    expect(screen.queryByText(/six-digit hex/)).toBeNull();
    await user.type(screen.getByLabelText("Hex"), "nope");
    expect(screen.getByText("Use a six-digit hex like #1f2a44.")).toBeVisible();
  });

  it("refuses to hand back a hex that is not one", async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<ShadeSheet {...props} onUse={onUse} />);

    await user.type(screen.getByLabelText("Hex"), "nope");
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(onUse).not.toHaveBeenCalled();

    // aria-disabled, never the attribute: a disabled button drops focus
    // and stops announcing (§Forms & failure).
    expect(screen.getByRole("button", { name: "Use this" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Use this" })).not.toBeDisabled();
  });

  it("hands back the normalised hex, lowercased", async () => {
    // One stored spelling of a colour: the field accepts a paste as well
    // as a sample, and brands publish `#1F2A44`.
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<ShadeSheet {...props} onUse={onUse} />);

    await user.type(screen.getByLabelText("Hex"), "#1F2A44");
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(onUse).toHaveBeenCalledWith("#1f2a44");
  });

  it("clears the field and the stored value together", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<ShadeSheet {...props} value="#1f2a44" onClear={onClear} />);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Hex")).toHaveValue("");
  });

  it("offers no sampler without a photo, and says to type it instead", () => {
    // "No photo → no sampler, the field stands alone." Not a disabled
    // affordance — a control that cannot do anything is worse than one
    // that is not there.
    render(<ShadeSheet {...props} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/paste what the brand published/i)).toBeVisible();
    expect(screen.queryByText(/tap the photo/i)).toBeNull();
  });

  it("offers the photo as the sampler when there is one", () => {
    render(<ShadeSheet {...props} photoUrl="/closet/photo/01ITEM/card" />);

    const photo = screen.getByAltText(/tap to sample a shade from your photo/i);
    expect(photo).toHaveAttribute("src", "/closet/photo/01ITEM/card");
    expect(screen.getByText(/tap the photo to sample/i)).toBeVisible();
    // Same-origin, which is what keeps the canvas untainted so a pixel can
    // be read back at all.
    expect(photo.getAttribute("src")).not.toMatch(/^https?:/);
  });

  it("starts from the hex it was given", () => {
    render(<ShadeSheet {...props} value="#abcdef" />);
    expect(screen.getByLabelText("Hex")).toHaveValue("#abcdef");
  });
});

describe("ShadeSheet: the sampler", () => {
  it("reads the pixel the tap landed on, not the first one", async () => {
    // "The sampler is a tap on the photo that reads the pixel under the
    // ring: no magnifier, no drag." A fixture with one colour could not
    // tell that apart from reading pixel zero every time.
    render(<ShadeSheet {...props} photoUrl="/closet/photo/01ITEM/card" />);

    await tapPhoto(0.1, 0.1);
    expect(screen.getByLabelText("Hex")).toHaveValue("#ff0000");

    await tapPhoto(0.9, 0.1);
    expect(screen.getByLabelText("Hex")).toHaveValue("#0000ff");
  });

  it("reads down as well as across", async () => {
    // The y axis is its own arithmetic, and a fixture one pixel tall
    // cannot tell a mistake in it from a correct answer.
    render(<ShadeSheet {...props} photoUrl="/closet/photo/01ITEM/card" />);

    await tapPhoto(0.1, 0.9);
    expect(screen.getByLabelText("Hex")).toHaveValue("#00ff00");

    await tapPhoto(0.9, 0.9);
    expect(screen.getByLabelText("Hex")).toHaveValue("#ffff00");
  });

  it("leaves what the runner typed alone when a tap reads nothing", async () => {
    // The sampler failing is not a reason to blank a field the runner
    // filled in by hand.
    render(<ShadeSheet {...props} photoUrl="/closet/photo/01ITEM/card" />);
    await userEvent.type(screen.getByLabelText("Hex"), "#1f2a44");

    installContext(() => NO_CONTEXT);
    await tapPhoto(0.9, 0.9);

    expect(screen.getByLabelText("Hex")).toHaveValue("#1f2a44");
  });

  it("puts a sampled shade straight into the field, ready to use", async () => {
    const onUse = vi.fn();
    render(
      <ShadeSheet
        {...props}
        onUse={onUse}
        photoUrl="/closet/photo/01ITEM/card"
      />,
    );

    await tapPhoto(0.9, 0.1);
    await userEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onUse).toHaveBeenCalledWith("#0000ff");
  });
});

describe("sampleFromTarget", () => {
  it("answers nothing when the tapped element holds no image", () => {
    // The real "no image" case. The sampler only renders with a photo, so
    // a ref read inside the handler is never unset by the time it runs —
    // taking the element is what makes this branch producible at all.
    const { container } = render(<button type="button">no photo</button>);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(sampleFromTarget(button ?? document.body, 0, 0)).toBeUndefined();
  });

  it("answers nothing when the canvas has no 2d context", () => {
    // A browser that refuses a context must leave the field alone rather
    // than write a colour nobody sampled. `beforeEach` puts the working
    // stub back.
    const { container } = render(
      <button type="button">
        <img alt="" src="/closet/photo/01ITEM/card" />
      </button>,
    );
    const button = container.querySelector("button");
    installContext(() => NO_CONTEXT);
    expect(sampleFromTarget(button ?? document.body, 0, 0)).toBeUndefined();
  });
});
