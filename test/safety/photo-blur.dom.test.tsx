import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { PhotoBlur } from "../../src/modules/safety/components/PhotoBlur";
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

describe("with blur on", () => {
  it("says it is checking before it knows anything", () => {
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // Not "No face found" — nothing has looked yet, and claiming a clean
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
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // The single worst failure this component could have is a canvas
    // showing a blurred face while the upload carries the original.
    await waitFor(() => {
      expect(onReady).toHaveBeenCalledWith(BLURRED);
    });
    expect(onReady).not.toHaveBeenCalledWith(PHOTO);
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
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/We blurred one face\. Missed something\?/),
      ).toBeInTheDocument();
    });
  });

  it("says no face found when the detector ran and saw nothing", async () => {
    const { pipeline } = fakePipeline();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No face found. Posting as-is."),
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
    expect(screen.queryByText(/No face found/)).not.toBeInTheDocument();
  });

  it("still offers tap-to-blur when there is no detector", async () => {
    const { pipeline } = fakePipeline({
      detect: () => Promise.resolve({ status: "unavailable" }),
    });
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={vi.fn()}
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
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/No face found/)).toBeInTheDocument();
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
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/No face found/)).toBeInTheDocument();
    });

    await user.click(
      screen.getByLabelText("Outfit photo. Tap a spot to blur it."),
    );

    // "We blurred" is a claim about detection; a tap is not one, and
    // crediting the model for it would overstate what it found.
    await waitFor(() => {
      expect(screen.getByText(/You blurred one spot/)).toBeInTheDocument();
    });
  });
});

describe("with blur turned off", () => {
  it("uploads the original and loads no detector at all", async () => {
    const user = userEvent.setup();
    const onReady = vi.fn();
    const detect = vi.fn().mockResolvedValue({ status: "ran", faces: [] });
    const { pipeline } = fakePipeline({ detect });
    const storage = emptyStorage();
    render(
      <PhotoBlur
        file={PHOTO}
        onReady={onReady}
        pipeline={pipeline}
        storage={storage}
      />,
    );
    await waitFor(() => {
      expect(detect).toHaveBeenCalled();
    });
    detect.mockClear();

    await user.click(screen.getByRole("checkbox", { name: "Blur faces" }));

    await waitFor(() => {
      expect(onReady).toHaveBeenCalledWith(PHOTO);
    });
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
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Blur faces" }));

    await waitFor(() => {
      expect(screen.queryByText("Tap to blur")).not.toBeInTheDocument();
    });
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
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/No face found/)).toBeInTheDocument();
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
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/No face found/)).toBeInTheDocument();
    });
    await act(async () => {
      first.resolve({ status: "ran", faces: [ONE_FACE] });
      await first.promise;
    });

    // Still "no face found" — the second photo's answer. Without the
    // guard the copy claims a face was blurred on a photo whose detector
    // found none, at coordinates from a different image.
    await waitFor(() => {
      expect(screen.getByText(/No face found/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/We blurred/)).not.toBeInTheDocument();
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
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );
    await waitFor(() => {
      expect(first).toHaveBeenCalled();
    });

    view.rerender(
      <PhotoBlur
        file={OTHER}
        onReady={second}
        pipeline={pipeline}
        storage={emptyStorage()}
      />,
    );

    // A publisher that closed over the first render's callback would keep
    // handing blurred bytes to a parent that has moved on — the verdict
    // form would upload the previous photo.
    await waitFor(() => {
      expect(second).toHaveBeenCalled();
    });
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
