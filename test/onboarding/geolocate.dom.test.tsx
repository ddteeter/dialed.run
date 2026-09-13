import { afterEach, describe, expect, it, vi } from "vitest";

import { geolocate } from "../../src/modules/onboarding/geolocate";

/**
 * The browser location ask.
 *
 * It lives in the DOM project because it *is* a DOM API, and the case that
 * matters is the one requirement 1 is about: a refusal must come back as
 * an answer rather than as a rejection, so no caller can forget to handle
 * it.
 */
function withGeolocation(
  getCurrentPosition: typeof navigator.geolocation.getCurrentPosition,
) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "geolocation");
});

describe("geolocate", () => {
  it("resolves the coordinates the browser gave", async () => {
    withGeolocation((onSuccess) => {
      onSuccess({
        coords: { latitude: 44.98, longitude: -93.27 },
      } as GeolocationPosition);
    });

    await expect(geolocate()).resolves.toEqual({ lat: 44.98, lng: -93.27 });
  });

  it("resolves to nothing when the runner refuses", async () => {
    // Not a rejection. A denied permission is an answer, and onboarding
    // carries on with the typed city — which it cannot do if this throws.
    withGeolocation((_onSuccess, onError) => {
      onError?.({ code: 1, message: "User denied" } as GeolocationPositionError);
    });

    await expect(geolocate()).resolves.toBeUndefined();
  });

  it("asks with a timeout, so a prompt nobody answers is not forever", async () => {
    const ask = vi.fn<typeof navigator.geolocation.getCurrentPosition>(
      (onSuccess) => {
        onSuccess({
          coords: { latitude: 0, longitude: 0 },
        } as GeolocationPosition);
      },
    );
    withGeolocation(ask);

    await geolocate();

    expect(ask.mock.calls[0]?.[2]).toEqual({ timeout: 10_000 });
  });
});
