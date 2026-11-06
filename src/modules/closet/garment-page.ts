import type { Units } from "../../lib/contracts";

interface GarmentLoaderContext<Location> {
  params: { itemId: string };
  location: Location;
}

/**
 * The loader a garment's page runs, for detail and for its edit form
 * alike: the session gate, then the piece and the viewer's units to print
 * its range in (R-94: the range used to print Celsius to everyone).
 *
 * One loader rather than two copies of it, because the two pages read the
 * same things and should go on doing so. The gate and both reads are the
 * route's server functions, handed in, so this file stays importable by a
 * test. The two reads go out together, since neither waits on the other.
 */
export function garmentLoader<Location, Detail>(
  gate: (location: Location) => Promise<unknown>,
  readDetail: (itemId: string) => Promise<Detail>,
  readUnits: () => Promise<Units>,
): (
  context: GarmentLoaderContext<Location>,
) => Promise<{ detail: Detail; units: Units }> {
  return async ({ params, location }) => {
    await gate(location);
    const [detail, units] = await Promise.all([
      readDetail(params.itemId),
      readUnits(),
    ]);
    return { detail, units };
  };
}
