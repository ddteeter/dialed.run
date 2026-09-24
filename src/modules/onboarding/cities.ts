import { z } from "zod";

/**
 * O1's city field suggests as you type (round 22, item 19): *"City field
 * suggests as you type; picking one makes the chip."*
 *
 * The suggestions come from Open-Meteo's geocoder, which needs no key and
 * so no binding: a keyless outbound GET, with the resilience laws' 10s
 * timeout and a zod parse like every other one (law 4). A picked city
 * carries its coordinates, which is what the climate band resolves best
 * from — a typed label with none behind it is still accepted, and is
 * resolved upstream by the weather provider as before.
 *
 * **It degrades to nothing, never to an error** (law 5): the field is
 * still a field, and a runner whose suggestions did not arrive types their
 * city and carries on. So every failure here — timeout, refusal, a shape
 * we do not recognise — is an empty list.
 */

/**
 * One suggestion: what the chip says, and where it is.
 */
export interface CitySuggestion {
  label: string;
  lat: number;
  lng: number;
}

const GEOCODER = "https://geocoding-api.open-meteo.com/v1/search";
const TIMEOUT_MS = 10_000;
const SUGGESTIONS = 5;

/**
 * Two letters before asking: one letter matches half the world, and a
 * list that long is noise rather than a suggestion.
 */
const SHORTEST_QUERY = 2;

const placeSchema = z.object({
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  admin1: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
});

/**
 * Open-Meteo leaves `results` out altogether when nothing matched, rather
 * than answering with an empty list.
 */
const answerSchema = z.object({ results: z.array(placeSchema).default([]) });

/**
 * "Minneapolis, Minnesota" — the place, then its region, or its country
 * where there is no region.
 */
function labelOf(place: z.infer<typeof placeSchema>): string {
  const within = place.admin1 ?? place.country;
  return within === undefined ? place.name : `${place.name}, ${within}`;
}

export const citySearchInput = z.object({ query: z.string().max(120) });

export async function searchCities(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CitySuggestion[]> {
  const name = query.trim();
  if (name.length < SHORTEST_QUERY) return [];

  const url = new URL(GEOCODER);
  url.searchParams.set("name", name);
  url.searchParams.set("count", String(SUGGESTIONS));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  let body: unknown;
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return [];
    body = await response.json();
  } catch {
    return [];
  }

  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return [];
  return parsed.data.results.map((place) => ({
    label: labelOf(place),
    lat: place.latitude,
    lng: place.longitude,
  }));
}
