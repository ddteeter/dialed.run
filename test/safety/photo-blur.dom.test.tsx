import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { z } from "zod";

import { photoAcceptAttribute } from "../../src/lib/photo-constraints";
import {
  PhotoBlur,
  photoBlurStep,
} from "../../src/modules/safety/components/PhotoBlur";
import type {
  BlurPipeline,
  LoadedImage,
} from "../../src/modules/safety/blur/pipeline";
import type { DetectionOutcome } from "../../src/modules/safety/blur/detect";
import type { BlurRegion } from "../../src/modules/safety/blur/regions";

/**
 * jsdom's `getContext("2d")` is null, so the pixels are injected and what
 * these assert is the decisions: is blur on, what did the detector say,
 * what does the copy claim, and — the one that matters most — which bytes
 * get handed to the uploader.
 */

const PHOTO = new File([new Uint8Array([1, 2, 3])], "run.jpg", {
  type: "image/jpeg",
});
const BLURRED = new File([new Uint8Array([9])], "run.jpg", {
  type: "image/jpeg",
});

function fakePipeline(overrides: Partial<BlurPipeline> = {}): {
  pipeline: BlurPipeline;
  painted: BlurRegion[][];
} {
  const painted: BlurRegion[][] = [];
  const pipeline: BlurPipeline = {
    load: () =>
      Promise.resolve({
        image: {} as ImageBitmap,
        width: 1000,
        height: 1000,
      }),
    detect: () => Promise.resolve({ status: "ran", faces: [] }),
    paint: (_canvas, _image, _w, _h, regions) => {
      painted.push([...regions]);
    },
    toFile: () => Promise.resolve(BLURRED),
    ...overrides,
  };
  return { pipeline, painted };
}

/**
 * `Storage` must return `null` and the repo forbids the literal; parsed
 * through zod rather than cast, same idiom as the other fixtures.
 */
const NOTHING = z.null().parse(JSON.parse("null"));

/**
A storage that starts empty, so the default (blur on) applies.
*/
function emptyStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    key: () => NOTHING,
    getItem: (key: string) => values.get(key) ?? NOTHING,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

/**
 * Round 28 #5: nothing is handed over until the runner presses Use this
 * photo, and the press waits behind `aria-disabled` while the bytes are
 * being made.
 */
async function useThisPhoto(): Promise<void> {
  const use = screen.getByRole("button", { name: "Use this photo" });
  await waitFor(() => {
    expect(use).not.toHaveAttribute("aria-disabled");
  });
  await userEvent.click(use);
}

describe("with blur on", () => {
  it("says it is checking before it knows anything", () => {
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // Not "found nothing" — nothing has looked yet, and claiming a clean
    // sweep before the detector has run is the same lie one beat early.
    expect(screen.getByText("Checking this photo…")).toBeInTheDocument();
  });

  it("uploads the BLURRED file, never the original", async () => {
    const onReady = vi.fn();
    const { pipeline } = fakePipeline({
      detect: () =>
        Promise.resolve({
          status: "ran",
          faces: [{ x: 10, y: 10, width: 50, height: 50 }],
        }),
    });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // The single worst failure this component could have is a canvas
    // showing a blurred face while the upload carries the original.
    await useThisPhoto();
    expect(onReady).toHaveBeenCalledExactlyOnceWith(BLURRED);
  });

  it("reports what the detector found, in the artboard's words", async () => {
    const { pipeline } = fakePipeline({
      detect: () =>
        Promise.resolve({
          status: "ran",
          faces: [{ x: 1, y: 1, width: 10, height: 10 }],
        }),
    });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Auto-blur covered 1 area\. Tap the photo/),
      ).toBeInTheDocument();
    });
  });

  it("says no face found when the detector ran and saw nothing", async () => {
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Auto-blur found nothing to cover. Tap the photo or a cell to blur an area.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("does not claim a clean sweep when there was no detector", async () => {
    const { pipeline } = fakePipeline({
      detect: () => Promise.resolve({ status: "unavailable" }),
    });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // The whole point of keeping `unavailable` distinct all the way to
    // the copy: a browser that could not look must not borrow the
    // sentence of one that did.
    await waitFor(() => {
      expect(screen.getByText(/couldn't check this photo/)).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/Auto-blur found nothing/),
    ).not.toBeInTheDocument();
  });

  it("still offers tap-to-blur when there is no detector", async () => {
    const { pipeline } = fakePipeline({
      detect: () => Promise.resolve({ status: "unavailable" }),
    });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // Tap-to-blur is not a fallback — it is what makes the wording honest,
    // so it must be there whatever the detector did.
    await waitFor(() => {
      expect(screen.getByText("Tap to blur")).toBeInTheDocument();
    });
    expect(
      screen.getByLabelText("Outfit photo. Tap a spot to blur it."),
    ).toBeInTheDocument();
  });
});

describe("tapping", () => {
  it("adds a region and repaints with it", async () => {
    const user = userEvent.setup();
    const { pipeline, painted } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Auto-blur found nothing/)).toBeInTheDocument();
    });

    await user.click(
      screen.getByLabelText("Outfit photo. Tap a spot to blur it."),
    );

    await waitFor(() => {
      expect(painted.at(-1)).toHaveLength(1);
    });
    expect(painted.at(-1)?.[0]?.source).toBe("tapped");
  });

  it("credits the runner rather than the model for it", async () => {
    const user = userEvent.setup();
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Auto-blur found nothing/)).toBeInTheDocument();
    });

    await user.click(
      screen.getByLabelText("Outfit photo. Tap a spot to blur it."),
    );

    // "We blurred" is a claim about detection; a tap is not one, and
    // crediting the model for it would overstate what it found.
    await waitFor(() => {
      expect(
        screen.getByText("You blurred 1 spot. Tap one to undo."),
      ).toBeInTheDocument();
    });
  });

  it("undoes the spot when the runner taps it again", async () => {
    const user = userEvent.setup();
    const { pipeline, painted } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Auto-blur found nothing/)).toBeInTheDocument();
    });
    const photo = screen.getByLabelText("Outfit photo. Tap a spot to blur it.");

    // The same point twice: the second tap lands inside the first spot.
    await user.click(photo);
    await screen.findByText("You blurred 1 spot. Tap one to undo.");
    await user.click(photo);

    await waitFor(() => {
      expect(painted.at(-1)).toHaveLength(0);
    });
    expect(
      screen.getByText(
        "Auto-blur found nothing to cover. Tap the photo or a cell to blur an area.",
      ),
    ).toBeVisible();
  });
});

describe("with blur turned off", () => {
  it("uploads the photo redrawn, never the original, and loads no detector", async () => {
    const user = userEvent.setup();
    const onReady = vi.fn();
    const detect = vi.fn().mockResolvedValue({ status: "ran", faces: [] });
    const { pipeline } = fakePipeline({ detect });
    const storage = emptyStorage();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    await waitFor(() => {
      expect(detect).toHaveBeenCalled();
    });
    detect.mockClear();

    await user.click(screen.getByRole("checkbox", { name: "Blur faces" }));

    // Redrawn through the canvas (task 128 · SAF-2): the original carries
    // the phone's metadata, GPS included, and is never what leaves.
    await useThisPhoto();
    expect(onReady).toHaveBeenCalledExactlyOnceWith(BLURRED);
    // Not loading the model is the entire point of remembering a refusal:
    // it is ~2.6 MB brotli and ~11.9 MB instantiated.
    expect(detect).not.toHaveBeenCalled();
  });

  it("remembers the refusal for next time", async () => {
    const user = userEvent.setup();
    const storage = emptyStorage();
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Blur faces" }));

    expect(storage.getItem("dialed.blurFaces")).toBe("off");
  });

  it("hides the photo surface entirely", async () => {
    const user = userEvent.setup();
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Blur faces" }));

    await waitFor(() => {
      expect(screen.queryByText("Tap to blur")).not.toBeInTheDocument();
    });
  });

  it("says what that means, in the slot the outcome sat in", async () => {
    const user = userEvent.setup();
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const outcome = await screen.findByText(
      "Auto-blur found nothing to cover. Tap the photo or a cell to blur an area.",
    );

    await user.click(screen.getByRole("checkbox", { name: "Blur faces" }));

    // Round 22, item 22: the same paragraph, now saying blur is off —
    // plain body copy, not a warning colour.
    expect(outcome).toHaveTextContent(
      "Faces won't be blurred. Anyone in this photo can be recognised.",
    );
    expect(outcome).toHaveClass("text-small");
    expect(outcome.className).not.toMatch(/failure|hiviz|cold/u);
  });
});

describe("when the canvas cannot produce a file", () => {
  it("hands back nothing rather than the original", async () => {
    const onReady = vi.fn();
    const { pipeline } = fakePipeline({
      toFile: () => Promise.resolve(undefined),
    });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Auto-blur found nothing/)).toBeInTheDocument();
    });
    // A fallback to `file` here would upload exactly the frame this
    // screen promises never leaves the device, and would do it silently.
    expect(onReady).not.toHaveBeenCalled();
  });
});

/**
 * A second file, so the component sees the prop change.
 */
const OTHER = new File([new Uint8Array([4])], "other.jpg", {
  type: "image/jpeg",
});

const ONE_FACE = { x: 1, y: 1, width: 10, height: 10 };

describe("when the runner picks a second photo mid-check", () => {
  it("does not apply the first photo's faces to the second", async () => {
    // The case the cancellation flag is really for. An unmount cannot
    // show it — React drops a setState on an unmounted tree silently —
    // but a *changed* file leaves the component mounted and perfectly
    // willing to accept the old photo's answer about the new photo.
    const first = Promise.withResolvers<DetectionOutcome>();
    let calls = 0;
    const { pipeline } = fakePipeline({
      detect: () => {
        calls += 1;
        return calls === 1
          ? first.promise
          : Promise.resolve({ status: "ran", faces: [] });
      },
    });
    const view = render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(calls).toBe(1);
    });

    view.rerender(
      <PhotoBlur
        file={OTHER}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Auto-blur found nothing/)).toBeInTheDocument();
    });
    await act(async () => {
      first.resolve({ status: "ran", faces: [ONE_FACE] });
      await first.promise;
    });

    // Still "no face found" — the second photo's answer. Without the
    // guard the copy claims a face was blurred on a photo whose detector
    // found none, at coordinates from a different image.
    await waitFor(() => {
      expect(screen.getByText(/Auto-blur found nothing/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Auto-blur covered/)).not.toBeInTheDocument();
  });

  it("does not decode the first photo over the second", async () => {
    // The earlier await. A load that resolves after the file changed
    // would hand the canvas the wrong image while the copy describes the
    // right one.
    const first = Promise.withResolvers<LoadedImage>();
    const firstImage = {} as ImageBitmap;
    const secondImage = {} as ImageBitmap;
    let calls = 0;
    const { pipeline } = fakePipeline({
      load: () => {
        calls += 1;
        return calls === 1
          ? first.promise
          : Promise.resolve({ image: secondImage, width: 20, height: 20 });
      },
    });
    const drawn: CanvasImageSource[] = [];
    const watching: BlurPipeline = {
      ...pipeline,
      paint: (_canvas, image) => {
        drawn.push(image);
      },
    };
    const view = render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={watching}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(calls).toBe(1);
    });

    view.rerender(
      <PhotoBlur
        file={OTHER}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={watching}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(drawn).toContain(secondImage);
    });
    await act(async () => {
      first.resolve({ image: firstImage, width: 10, height: 10 });
      await first.promise;
    });

    expect(drawn).not.toContain(firstImage);
  });
});

describe("the first paint", () => {
  it("carries no regions, so nothing is blurred that nothing found", async () => {
    // The detector is held open, so what gets painted first is the
    // starting list rather than its answer.
    const held = Promise.withResolvers<DetectionOutcome>();
    const { pipeline, painted } = fakePipeline({ detect: () => held.promise });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // The photo is drawn through before the detector has said anything.
    // A non-empty starting list would smear a rectangle over every photo
    // in the app and credit it to a tap nobody made.
    await waitFor(() => {
      expect(painted.length).toBeGreaterThan(0);
    });
    expect(painted[0]).toEqual([]);
    held.resolve({ status: "ran", faces: [] });
  });
});

describe("when the caller swaps its callback", () => {
  it("hands the bytes to the current one, not the one from first render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { pipeline } = fakePipeline();
    const view = render(
      <PhotoBlur
        file={PHOTO}
        onReady={first}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await useThisPhoto();
    expect(first).toHaveBeenCalledTimes(1);

    view.rerender(
      <PhotoBlur
        file={OTHER}
        onReady={second}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // A press that closed over the first render's callback would keep
    // handing blurred bytes to a parent that has moved on — the verdict
    // form would upload the previous photo.
    await useThisPhoto();
    expect(second).toHaveBeenCalledExactlyOnceWith(BLURRED);
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe("before the photo has decoded", () => {
  it("shows no canvas at all, so there is nothing to tap onto", async () => {
    const held = Promise.withResolvers<LoadedImage>();
    const { pipeline, painted } = fakePipeline({ load: () => held.promise });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // A canvas on screen while the copy still says "checking" is a blank
    // rectangle that accepts taps it cannot place — the coordinates map
    // onto an image that does not exist yet.
    expect(screen.getByText("Checking this photo…")).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Tap a spot to blur it/),
    ).not.toBeInTheDocument();

    held.resolve({ image: {} as ImageBitmap, width: 100, height: 100 });
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Tap a spot to blur it/),
      ).toBeInTheDocument();
    });
    expect(painted.length).toBeGreaterThan(0);
  });
});

describe("the blur toggle itself", () => {
  it("is a named, writable control, not a decoration", () => {
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // `ToggleField` takes the form primitives' field props, and this
    // toggle is not inside a form — so the props are supplied by hand and
    // nothing else checks them. Without a name the control has no
    // identity; marked readonly it reads to assistive tech as one a
    // runner cannot change, which is the opposite of what it is.
    const toggle = screen.getByRole("checkbox", { name: /Blur faces/ });
    expect(toggle).toHaveAttribute("name", "blurFaces");
    expect(toggle).not.toHaveAttribute("readonly");
  });
});

/**
 * A caller that does not care which bytes come back.
 *
 * Named rather than written inline five times: `() => {}` trips
 * `unicorn/no-useless-undefined` when it returns one, and five copies of
 * the comment that silences it is five chances to write a different one.
 */
function noop(): void {
  // These cases assert what is announced, not what is uploaded.
}

/**
 * Rule 08 · **announce once, politely** — one `role="status"` per screen.
 *
 * *"The three sentences (looking / blurred one / couldn't look) go to the
 * status region."* They used to go to a second `aria-live` paragraph
 * *here*, on a screen that already mounts the verdict form's — two regions
 * firing at once, which is how one of them is lost. The contract's
 * screen-reader pass for this exact screen asks for *"never silence,
 * never twice"*.
 *
 * There is no "Copied" and no autosave anywhere in v1 — nothing copies a
 * link or leaves the device — so these three sentences are the whole of
 * rule 08's non-form half, and the fix is that they borrow the region the
 * screen already has. `test/modules/verdict-form.dom.test.tsx` counts the
 * regions; these say what reaches the one that is left.
 */
describe("the sentences go to the screen's region, not one of their own", () => {
  it("opens no live region here", async () => {
    // The paragraph is still on screen and still says what happened — it
    // is copy on the artboard. What it is not any more is an announcer.
    const { pipeline } = fakePipeline();
    const { container } = render(
      <PhotoBlur
        file={PHOTO}
        onReady={noop}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Auto-blur found nothing to cover. Tap the photo or a cell to blur an area.",
        ),
      ).toBeVisible();
    });
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it("hands over both sentences, in order", async () => {
    // Both, because the contract's pass is "hear 'checking', then either
    // 'we blurred one' or 'we couldn't look'". Asserting only the last
    // would pass on a component that stayed silent until it finished,
    // which is the silence the rule rules out.
    const announced: string[] = [];
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={noop}
        onCancel={noop}
        onAnnounce={(sentence) => {
          announced.push(sentence);
        }}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(announced.length).toBeGreaterThan(1);
    });
    expect(announced[0]).toBe("Checking this photo");
    expect(announced.at(-1)).toBe(
      "Auto-blur found nothing to cover. Tap the photo or a cell to blur an area.",
    );
  });

  it("draws the ellipsis it does not announce", () => {
    // The one place in the app where the drawn and announced strings
    // differ on purpose, and design's reason (round 14): a status region
    // reads the ellipsis out, which is punctuation being spoken rather
    // than a wait being conveyed.
    const announced: string[] = [];
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={noop}
        onCancel={noop}
        onAnnounce={(sentence) => {
          announced.push(sentence);
        }}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    expect(screen.getByText("Checking this photo…")).toBeVisible();
    expect(announced).toContain("Checking this photo");
    expect(announced).not.toContain("Checking this photo…");
  });

  it("announces once per change, never once per render", async () => {
    // "Never twice." The effect keys on the sentence, so a re-render that
    // changes nothing must not re-announce — a region written again with
    // the same string is a reader hearing it again.
    const announce = vi.fn();
    const { pipeline } = fakePipeline();
    const element = (
      <PhotoBlur
        file={PHOTO}
        onReady={noop}
        onCancel={noop}
        onAnnounce={announce}
        pipeline={pipeline}
        storage={emptyStorage()}
      />
    );
    const { rerender } = render(element);
    await waitFor(() => {
      expect(announce).toHaveBeenCalledTimes(2);
    });

    rerender(element);

    expect(announce).toHaveBeenCalledTimes(2);
  });

  it("says nothing at all when blur is off", async () => {
    // "Success is silent unless the runner did something." Turning blur
    // off is the runner declining the feature, and there is no outcome to
    // report — the copy beside the toggle already says the original is
    // what gets uploaded.
    const announce = vi.fn();
    const { pipeline } = fakePipeline();
    const storage = emptyStorage();
    storage.setItem("dialed.blurFaces", "off");
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={noop}
        onCancel={noop}
        onAnnounce={announce}
        pipeline={pipeline}
        storage={storage}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: /Blur faces/ }),
      ).not.toBeChecked();
    });
    expect(announce).not.toHaveBeenCalled();
  });
});

describe("photoBlurStep", () => {
  it("is PhotoBlur, handed exactly the file, the callbacks and the announcer", () => {
    // The shape every photo screen's slot takes (`ui/PhotoStep`), so the
    // verdict route and the garment route hand the same step in. Checked
    // as an element rather than rendered: rendering it for real starts the
    // browser pipeline, which happy-dom cannot run.
    const file = new File(["x"], "face.jpg", { type: "image/jpeg" });
    const onReady = vi.fn();
    const announce = vi.fn();
    const cancel = vi.fn();

    const step = photoBlurStep(file, onReady, announce, cancel);

    if (!isValidElement(step)) throw new Error("not an element");
    expect(step.type).toBe(PhotoBlur);
    expect(step.props).toStrictEqual({
      file,
      onReady,
      onCancel: cancel,
      onAnnounce: announce,
    });
  });
});

/**
Which ninths of the photo the overlay marks as the focused cell's.
*/
function focusedNinths(): (string | undefined)[] {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-ninth][data-focused]"),
  ].map((ninth) => ninth.dataset.ninth);
}

describe("the keyboard path (R-84(b))", () => {
  it("offers nine buttons named by position, once the photo has decoded", async () => {
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const group = await screen.findByRole("group", { name: "Blur by area" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toStrictEqual([
      "Blur top-left",
      "Blur top",
      "Blur top-right",
      "Blur left",
      "Blur middle",
      "Blur right",
      "Blur bottom-left",
      "Blur bottom",
      "Blur bottom-right",
    ]);
  });

  it("blurs the cell from the keyboard, says so, and undoes it", async () => {
    const user = userEvent.setup();
    const onReady = vi.fn();
    const { pipeline, painted } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const cell = await screen.findByRole("button", { name: "Blur top-left" });
    expect(cell).toHaveAttribute("aria-pressed", "false");
    // Unpressed, the cell shows nothing: its name says where it is.
    expect(cell.querySelector("svg")).toBeNull();

    cell.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(painted.at(-1)).toStrictEqual([
        {
          x: 0,
          y: 0,
          width: 1000 / 3,
          height: 1000 / 3,
          source: "tapped",
        },
      ]);
    });
    expect(cell).toHaveAttribute("aria-pressed", "true");
    // Pressed is ink with the pack's check (round 27 #27).
    expect(cell.querySelector("path")).toHaveAttribute("d", "M4 13l5 5L20 6");
    // Digits, always (round 26 #18).
    expect(
      screen.getByText("You blurred 1 spot. Tap one to undo."),
    ).toBeInTheDocument();

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(painted.at(-1)).toStrictEqual([]);
    });
    expect(cell).toHaveAttribute("aria-pressed", "false");
  });

  it("outlines the focused cell's ninth of the photo, and only while it has focus", async () => {
    const user = userEvent.setup();
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await screen.findByRole("group", { name: "Blur by area" });
    // Nine, laid over the canvas, and nothing marked before any focus.
    expect(document.querySelectorAll("[data-ninth]")).toHaveLength(9);
    expect(focusedNinths()).toStrictEqual([]);
    const overlay = document.querySelector("[data-ninth]")?.parentElement;
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay?.parentElement?.querySelector("canvas")).not.toBeNull();

    screen.getByRole("button", { name: "Blur bottom-right" }).focus();
    await waitFor(() => {
      expect(focusedNinths()).toStrictEqual(["bottom-right"]);
    });
    // The value, not just the attribute's presence: `[data-ninth][data-focused]`
    // above matches an empty `data-focused=""` too, which is what React
    // renders for an empty-string value, so only checking the value tells
    // "true" apart from a blank marker.
    const focusedNinth = document.querySelector('[data-ninth="bottom-right"]');
    expect(focusedNinth).toHaveAttribute("data-focused", "true");
    await user.tab({ shift: true });
    await waitFor(() => {
      expect(focusedNinths()).toStrictEqual(["bottom"]);
    });
    await user.tab();
    await user.tab();
    await waitFor(() => {
      expect(focusedNinths()).toStrictEqual([]);
    });
  });

  it("is not there with blur off", async () => {
    const storage = emptyStorage();
    storage.setItem("dialed.blurFaces", "off");
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          "Faces won't be blurred. Anyone in this photo can be recognised.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Blur top" })).toBeNull();
  });
});

describe("with blur off from the start (SAF-2)", () => {
  it("redraws the whole photo with nothing blurred, at its decoded size", async () => {
    const storage = emptyStorage();
    storage.setItem("dialed.blurFaces", "off");
    const onReady = vi.fn();
    const paint = vi.fn();
    const detect = vi.fn();
    const { pipeline } = fakePipeline({ paint, detect });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    await useThisPhoto();
    expect(onReady).toHaveBeenCalledExactlyOnceWith(BLURRED);
    expect(paint).toHaveBeenCalledTimes(1);
    expect(paint.mock.calls[0]?.slice(2)).toStrictEqual([1000, 1000, []]);
    expect(detect).not.toHaveBeenCalled();
  });

  it("hands back nothing when the canvas cannot make a file, and says so", async () => {
    const storage = emptyStorage();
    storage.setItem("dialed.blurFaces", "off");
    const onReady = vi.fn();
    const announce = vi.fn();
    const toFile = vi.fn(() => Promise.resolve(undefined));
    const { pipeline } = fakePipeline({ toFile });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        onAnnounce={announce}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    expect(await screen.findByText("Photo not added")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This photo couldn't be prepared without blur. Turn blur on, or pick another photo.",
      ),
    ).toBeInTheDocument();
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      "This photo couldn't be prepared without blur. Turn blur on, or pick another photo.",
    );
    expect(toFile).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("redraws again on Try again, and hands the new file over", async () => {
    const storage = emptyStorage();
    storage.setItem("dialed.blurFaces", "off");
    const onReady = vi.fn();
    const toFile = vi
      .fn<BlurPipeline["toFile"]>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(BLURRED);
    const { pipeline } = fakePipeline({ toFile });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await useThisPhoto();
    expect(onReady).toHaveBeenCalledExactlyOnceWith(BLURRED);
    expect(toFile).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Photo not added")).not.toBeInTheDocument();
  });

  it("drops a blur-off failure once blur is turned on", async () => {
    const storage = emptyStorage();
    storage.setItem("dialed.blurFaces", "off");
    const toFile = vi
      .fn<BlurPipeline["toFile"]>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(BLURRED);
    const { pipeline } = fakePipeline({ toFile });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    await screen.findByText("Photo not added");
    await user.click(screen.getByRole("checkbox", { name: "Blur faces" }));
    expect(screen.queryByText("Photo not added")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Blur faces" }));
    await waitFor(() => {
      expect(toFile).toHaveBeenCalledTimes(3);
    });
    expect(screen.queryByText("Photo not added")).not.toBeInTheDocument();
  });

  it("does not hand over a stale photo's redraw after a newer one", async () => {
    const storage = emptyStorage();
    storage.setItem("dialed.blurFaces", "off");
    const onReady = vi.fn();
    const { promise: held, resolve: finish } = Promise.withResolvers<File>();
    const toFile = vi
      .fn<BlurPipeline["toFile"]>()
      .mockReturnValueOnce(held)
      .mockResolvedValue(BLURRED);
    const { pipeline } = fakePipeline({ toFile });
    const { rerender } = render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    await waitFor(() => {
      expect(toFile).toHaveBeenCalledTimes(1);
    });
    rerender(
      <PhotoBlur
        file={OTHER}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    await waitFor(() => {
      expect(toFile).toHaveBeenCalledTimes(2);
    });
    const stale = new File([new Uint8Array([7])], "run.jpg");
    await act(async () => {
      finish(stale);
      await held;
    });
    await useThisPhoto();
    expect(onReady).toHaveBeenCalledExactlyOnceWith(BLURRED);
  });
});

describe("W3 waits for the runner (round 28 #5)", () => {
  it("names the upload after the photo it now holds", async () => {
    const toFile = vi.fn<BlurPipeline["toFile"]>().mockResolvedValue(BLURRED);
    const { pipeline } = fakePipeline({ toFile });
    const second = new File([new Uint8Array([2])], "second.jpg", {
      type: "image/jpeg",
    });
    const view = render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(toFile).toHaveBeenCalledWith(expect.anything(), "run.jpg");
    });

    view.rerender(
      <PhotoBlur
        file={second}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(toFile).toHaveBeenLastCalledWith(expect.anything(), "second.jpg");
    });
  });

  it("draws the head, and the foot under the cells", async () => {
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Check the blur" }),
    ).toBeInTheDocument();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const use = screen.getByRole("button", { name: "Use this photo" });
    const another = screen.getByLabelText("Pick another");
    expect(cancel).toHaveAttribute("type", "button");
    expect(use).toHaveAttribute("type", "button");
    // Under the cells, in the board's order.
    const cells = await screen.findByRole("group", { name: "Blur by area" });
    expect(cells.compareDocumentPosition(use)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(use.compareDocumentPosition(another)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("puts focus on the heading, so Tab reaches the cells before the primary", async () => {
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Check the blur" });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("hands nothing over once the blur has painted, until Use this photo", async () => {
    const onReady = vi.fn();
    const { pipeline, painted } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const use = screen.getByRole("button", { name: "Use this photo" });

    await waitFor(() => {
      expect(use).not.toHaveAttribute("aria-disabled");
    });
    expect(painted).toHaveLength(1);
    // The controls stay: the step is open until the runner says so.
    expect(onReady).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Blur top-left" }),
    ).toBeInTheDocument();
  });

  it("waits behind its busy state while there is nothing to hand over", async () => {
    const onReady = vi.fn();
    const held = Promise.withResolvers<File | undefined>();
    const { pipeline } = fakePipeline({ toFile: () => held.promise });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const use = screen.getByRole("button", { name: "Use this photo" });
    expect(use).toHaveAttribute("aria-disabled", "true");
    expect(use).toHaveAttribute("aria-busy", "true");

    await user.click(use);

    expect(onReady).not.toHaveBeenCalled();
    await act(async () => {
      held.resolve(BLURRED);
      await held.promise;
    });
    expect(use).not.toHaveAttribute("aria-busy");
  });

  it("never hands over the bytes from before a tap while the new ones are made", async () => {
    const onReady = vi.fn();
    const later = Promise.withResolvers<File | undefined>();
    const tapped = new File([new Uint8Array([4])], "run.jpg");
    const toFile = vi
      .fn<BlurPipeline["toFile"]>()
      .mockResolvedValueOnce(BLURRED)
      .mockReturnValueOnce(later.promise);
    const { pipeline } = fakePipeline({ toFile });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const use = screen.getByRole("button", { name: "Use this photo" });
    await waitFor(() => {
      expect(use).not.toHaveAttribute("aria-disabled");
    });

    await user.click(screen.getByRole("button", { name: "Blur top-left" }));

    await waitFor(() => {
      expect(use).toHaveAttribute("aria-disabled", "true");
    });
    await user.click(use);
    expect(onReady).not.toHaveBeenCalled();

    await act(async () => {
      later.resolve(tapped);
      await later.promise;
    });
    await useThisPhoto();
    expect(onReady).toHaveBeenCalledExactlyOnceWith(tapped);
  });

  it("keeps the newest paint's bytes when an older one finishes last", async () => {
    const onReady = vi.fn();
    const slow = Promise.withResolvers<File | undefined>();
    const old = new File([new Uint8Array([5])], "run.jpg");
    const newest = new File([new Uint8Array([6])], "run.jpg");
    const toFile = vi
      .fn<BlurPipeline["toFile"]>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(newest);
    const { pipeline } = fakePipeline({ toFile });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const cell = await screen.findByRole("button", { name: "Blur top-left" });
    await user.click(cell);
    const use = screen.getByRole("button", { name: "Use this photo" });
    await waitFor(() => {
      expect(use).not.toHaveAttribute("aria-disabled");
    });

    await act(async () => {
      slow.resolve(old);
      await slow.promise;
    });
    await useThisPhoto();
    expect(onReady).toHaveBeenCalledExactlyOnceWith(newest);
  });

  it("forgets the blur-off redraw the moment blur goes back on", async () => {
    const storage = emptyStorage();
    storage.setItem("dialed.blurFaces", "off");
    const onReady = vi.fn();
    const decoding = Promise.withResolvers<LoadedImage>();
    const load = vi
      .fn<BlurPipeline["load"]>()
      .mockResolvedValueOnce({
        image: {} as ImageBitmap,
        width: 10,
        height: 10,
      })
      .mockReturnValueOnce(decoding.promise);
    const { pipeline } = fakePipeline({ load });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    const use = screen.getByRole("button", { name: "Use this photo" });
    await waitFor(() => {
      expect(use).not.toHaveAttribute("aria-disabled");
    });

    await user.click(screen.getByRole("checkbox", { name: "Blur faces" }));

    // The unblurred redraw is not one press from the upload any more.
    expect(use).toHaveAttribute("aria-disabled", "true");
    await user.click(use);
    expect(onReady).not.toHaveBeenCalled();
    decoding.resolve({ image: {} as ImageBitmap, width: 10, height: 10 });
  });

  it("adds nothing on Cancel", async () => {
    const onReady = vi.fn();
    const onCancel = vi.fn();
    const { pipeline } = fakePipeline();
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={onCancel}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Use this photo" }),
      ).not.toHaveAttribute("aria-disabled");
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("takes Esc as Cancel, and no other key", async () => {
    const onCancel = vi.fn();
    const { pipeline } = fakePipeline();
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={onCancel}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Check the blur" });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });

    await user.keyboard("a");
    expect(onCancel).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("offers Pick another as the picker itself, for photos only", () => {
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // The label is the press; the input inside it opens the picker.
    const input = screen.getByLabelText("Pick another");
    expect(input).toBe(picker());
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", photoAcceptAttribute);
  });

  it("checks a new pick from the start, and hands that one over", async () => {
    const onReady = vi.fn();
    const second = new File([new Uint8Array([8])], "second.jpg", {
      type: "image/jpeg",
    });
    const secondBlurred = new File([new Uint8Array([3])], "second.jpg");
    const decoding = Promise.withResolvers<LoadedImage>();
    const load = vi
      .fn<BlurPipeline["load"]>()
      .mockResolvedValueOnce({
        image: {} as ImageBitmap,
        width: 1000,
        height: 1000,
      })
      .mockReturnValueOnce(decoding.promise);
    const toFile = vi
      .fn<BlurPipeline["toFile"]>()
      .mockResolvedValueOnce(BLURRED)
      .mockResolvedValue(secondBlurred);
    const { pipeline, painted } = fakePipeline({ load, toFile });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Blur top-left" }),
    );
    const use = screen.getByRole("button", { name: "Use this photo" });
    await waitFor(() => {
      expect(use).not.toHaveAttribute("aria-disabled");
    });

    await user.upload(picker(), second);

    // A new photo is checked as if it had just been picked: nothing to
    // hand over, no canvas, no blur carried over from the last one.
    expect(load).toHaveBeenLastCalledWith(second);
    expect(use).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Checking this photo…")).toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeNull();
    const before = painted.length;
    await act(async () => {
      decoding.resolve({ image: {} as ImageBitmap, width: 1000, height: 1000 });
      await decoding.promise;
    });
    await waitFor(() => {
      expect(painted.length).toBeGreaterThan(before);
    });
    expect(painted[before]).toStrictEqual([]);

    await useThisPhoto();
    expect(onReady).toHaveBeenCalledExactlyOnceWith(secondBlurred);
  });

  it("leaves the photo as it was when the picker is dismissed", async () => {
    const load = vi.fn<BlurPipeline["load"]>().mockResolvedValue({
      image: {} as ImageBitmap,
      width: 1000,
      height: 1000,
    });
    const { pipeline } = fakePipeline({ load });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const use = screen.getByRole("button", { name: "Use this photo" });
    await waitFor(() => {
      expect(use).not.toHaveAttribute("aria-disabled");
    });

    // A dismissed picker is an empty list; one with no list at all is the
    // same nothing, and neither may throw.
    fireEvent.change(picker(), { target: { files: [] } });
    Object.defineProperty(picker(), "files", { value: NOTHING });
    fireEvent.change(picker());

    expect(load).toHaveBeenCalledTimes(1);
    expect(use).not.toHaveAttribute("aria-disabled");
  });
});

const DECODED: LoadedImage = {
  image: {} as ImageBitmap,
  width: 1000,
  height: 1000,
};

const PREPARE_FAILED =
  "This photo couldn't be prepared. Pick another photo, or cancel.";

/**
The control-failure band, if one is on screen.
*/
function band(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-part='failure-band']");
}

describe("Pick another checks a file as the well does", () => {
  it("refuses a PDF in the field's own words, and keeps the photo it had", async () => {
    const onReady = vi.fn();
    const load = vi.fn<BlurPipeline["load"]>().mockResolvedValue(DECODED);
    const { pipeline } = fakePipeline({ load });
    const user = userEvent.setup({ applyAccept: false });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    const use = screen.getByRole("button", { name: "Use this photo" });
    await waitFor(() => {
      expect(use).not.toHaveAttribute("aria-disabled");
    });
    expect(picker()).not.toHaveAttribute("aria-invalid");
    expect(picker()).not.toHaveAttribute("aria-describedby");

    await user.upload(
      picker(),
      new File(["%PDF"], "kit.pdf", { type: "application/pdf" }),
    );

    // `photoProblem`'s sentence — the one A2's well says — marked on the
    // picker, which is where the fix is.
    const message = screen.getByText("Photos must be JPG, PNG or WebP.");
    expect(message).toHaveAttribute("id", "pick-another-message");
    expect(picker()).toHaveAttribute("aria-invalid", "true");
    expect(picker()).toHaveAttribute(
      "aria-describedby",
      "pick-another-message",
    );
    // Nothing was decoded for it, and the photo already checked is still
    // the one Use this photo hands over.
    expect(load).toHaveBeenCalledTimes(1);
    expect(use).not.toHaveAttribute("aria-disabled");
    await user.click(use);
    expect(onReady).toHaveBeenCalledExactlyOnceWith(BLURRED);
  });

  it("clears the mark once a photo it takes is picked", async () => {
    const second = new File([new Uint8Array([8])], "second.jpg", {
      type: "image/jpeg",
    });
    const load = vi.fn<BlurPipeline["load"]>().mockResolvedValue(DECODED);
    const { pipeline } = fakePipeline({ load });
    const user = userEvent.setup({ applyAccept: false });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await user.upload(
      picker(),
      new File(["x"], "kit.heic", { type: "image/heic" }),
    );
    expect(screen.getByText("Photos must be JPG, PNG or WebP.")).toBeVisible();

    await user.upload(picker(), second);

    expect(screen.queryByText("Photos must be JPG, PNG or WebP.")).toBeNull();
    expect(picker()).not.toHaveAttribute("aria-invalid");
    expect(picker()).not.toHaveAttribute("aria-describedby");
    expect(load).toHaveBeenLastCalledWith(second);
  });

  it("says a refusal into the screen's one region", async () => {
    const onAnnounce = vi.fn();
    const { pipeline } = fakePipeline();
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        onAnnounce={onAnnounce}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await user.upload(
      picker(),
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.jpg", {
        type: "image/jpeg",
      }),
    );

    expect(onAnnounce).toHaveBeenCalledWith(
      "That photo is over 10 MB. Pick a smaller one.",
    );
  });
});

describe("when the photo cannot be prepared", () => {
  it("says so on the band when the file will not decode, and Use this photo goes", async () => {
    const onAnnounce = vi.fn();
    const load = vi
      .fn<BlurPipeline["load"]>()
      .mockRejectedValueOnce(new Error("undecodable"))
      .mockResolvedValue(DECODED);
    const { pipeline } = fakePipeline({ load });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        onAnnounce={onAnnounce}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // Caught, not an unhandled rejection: the band says what is still
    // true and the two ways out, and nothing waits forever behind a busy
    // Use this photo.
    await waitFor(() => {
      expect(band()).not.toBeNull();
    });
    expect(band()).toHaveTextContent("Photo not added");
    expect(band()).toHaveTextContent(PREPARE_FAILED);
    expect(onAnnounce).toHaveBeenCalledWith(PREPARE_FAILED);
    expect(screen.queryByRole("button", { name: "Use this photo" })).toBeNull();
    expect(screen.getByLabelText("Pick another")).toBe(picker());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();

    // Try again decodes again; a decode that works brings the photo back.
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(load).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Use this photo" }),
      ).not.toHaveAttribute("aria-disabled");
    });
    expect(band()).toBeNull();
  });

  it("starts over with the photo Pick another chose", async () => {
    const second = new File([new Uint8Array([8])], "second.jpg", {
      type: "image/jpeg",
    });
    const load = vi
      .fn<BlurPipeline["load"]>()
      .mockRejectedValueOnce(new Error("undecodable"))
      .mockResolvedValue(DECODED);
    const { pipeline } = fakePipeline({ load });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(band()).not.toBeNull();
    });

    await user.upload(picker(), second);

    expect(band()).toBeNull();
    expect(load).toHaveBeenLastCalledWith(second);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Use this photo" }),
      ).not.toHaveAttribute("aria-disabled");
    });
  });

  it("says so when the blurred canvas makes no file, and a tap that paints again clears it", async () => {
    const onReady = vi.fn();
    const toFile = vi
      .fn<BlurPipeline["toFile"]>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(BLURRED);
    const { pipeline } = fakePipeline({ toFile });
    const user = userEvent.setup();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(band()).toHaveTextContent(PREPARE_FAILED);
    });
    expect(screen.queryByRole("button", { name: "Use this photo" })).toBeNull();
    expect(onReady).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Blur top-left" }));

    await useThisPhoto();
    expect(band()).toBeNull();
    expect(onReady).toHaveBeenCalledExactlyOnceWith(BLURRED);
  });

  it("takes a canvas that throws as one that made no file", async () => {
    const { pipeline } = fakePipeline({
      toFile: () => Promise.reject(new Error("tainted")),
    });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(band()).toHaveTextContent(PREPARE_FAILED);
    });
  });

  it("takes a blur-off canvas that throws as the redraw failing", async () => {
    const storage = emptyStorage();
    storage.setItem("dialed.blurFaces", "off");
    const { pipeline } = fakePipeline({
      toFile: () => Promise.reject(new Error("tainted")),
    });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={storage}
      />,
    );

    await waitFor(() => {
      expect(band()).toHaveTextContent(
        "This photo couldn't be prepared without blur. Turn blur on, or pick another photo.",
      );
    });
  });

  it("takes a detector that throws as one that could not look, not as a failure", async () => {
    const { pipeline } = fakePipeline({
      detect: () => Promise.reject(new Error("model")),
    });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        onCancel={noop}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // The photo is still one the runner can blur by hand, so this is the
    // honest "couldn't check" line and the photo stays usable.
    await waitFor(() => {
      expect(screen.getByText(/couldn't check this photo/)).toBeInTheDocument();
    });
    expect(band()).toBeNull();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Use this photo" }),
      ).not.toHaveAttribute("aria-disabled");
    });
  });
});

/**
The hidden input Pick another opens.
*/
function picker(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    "[data-part='pick-another']",
  );
  if (found === null) throw new Error("no picker");
  return found;
}
