import { describe, expect, it, vi } from "vitest";

import {
  citySearchInput,
  searchCities,
} from "../../src/modules/onboarding/cities";

/**
 * O1's suggestions (round 22, item 19), from a keyless geocoder: a
 * timeout and a parse on the way in (law 4), and nothing — never an error —
 * on the way out when anything goes wrong (law 5).
 */
function answering(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(body, { status })),
  );
}

const MINNEAPOLIS = {
  name: "Minneapolis",
  latitude: 44.98,
  longitude: -93.26,
  admin1: "Minnesota",
  country: "United States",
};

describe("searchCities", () => {
  it("asks for five English matches for the trimmed name, with a timeout", async () => {
    const fetchImpl = answering({ results: [MINNEAPOLIS] });

    await searchCities("  Minnea ", fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const asked = new URL(url instanceof Request ? url.url : (url ?? ""));
    expect(`${asked.origin}${asked.pathname}`).toBe(
      "https://geocoding-api.open-meteo.com/v1/search",
    );
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      name: "Minnea",
      count: "5",
      language: "en",
      format: "json",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("labels each match by its region, or its country when it has none", async () => {
    const found = await searchCities(
      "Mi",
      answering({
        results: [
          MINNEAPOLIS,
          { name: "Milan", latitude: 45.46, longitude: 9.19, country: "Italy" },
          { name: "Nowhere", latitude: 0, longitude: 0 },
        ],
      }),
    );
    expect(found).toEqual([
      { label: "Minneapolis, Minnesota", lat: 44.98, lng: -93.26 },
      { label: "Milan, Italy", lat: 45.46, lng: 9.19 },
      { label: "Nowhere", lat: 0, lng: 0 },
    ]);
  });

  it("does not ask for fewer than two letters", async () => {
    const fetchImpl = answering({ results: [MINNEAPOLIS] });
    expect(await searchCities(" M ", fetchImpl)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await searchCities("Mi", fetchImpl)).toHaveLength(1);
  });

  it("reads a missing results list as no matches", async () => {
    expect(await searchCities("Zzq", answering({}))).toEqual([]);
  });

  it("answers nothing when the geocoder refuses", async () => {
    expect(
      await searchCities("Minnea", answering({ results: [MINNEAPOLIS] }, 503)),
    ).toEqual([]);
  });

  it("answers nothing when the geocoder cannot be reached or times out", async () => {
    const down = vi.fn<typeof fetch>(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );
    expect(await searchCities("Minnea", down)).toEqual([]);
  });

  it("answers nothing for a body that is not JSON, or not the shape", async () => {
    const garbled = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("<html>", { status: 200 })),
    );
    expect(await searchCities("Minnea", garbled)).toEqual([]);
    expect(
      await searchCities(
        "Minnea",
        answering({
          results: [{ name: "Minneapolis", latitude: 200, longitude: 0 }],
        }),
      ),
    ).toEqual([]);
    expect(
      await searchCities(
        "Minnea",
        answering({ results: [{ ...MINNEAPOLIS, name: "" }] }),
      ),
    ).toEqual([]);
  });

  it("takes a bounded query from the client", () => {
    expect(citySearchInput.safeParse({ query: "x".repeat(120) }).success).toBe(
      true,
    );
    expect(citySearchInput.safeParse({ query: "x".repeat(121) }).success).toBe(
      false,
    );
  });
});
