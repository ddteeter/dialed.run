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
 * test. The reads go out together, since none waits on another.
 *
 * And the bell's state, since both pages wear it (Design 169.2). After
 * the gate like the rest: a signed-out visitor is sent to log in, and the
 * bell's own read would otherwise race that redirect with an error.
 */
export function garmentLoader<Location, Detail, Bell>(
  gate: (location: Location) => Promise<unknown>,
  readDetail: (itemId: string) => Promise<Detail>,
  readUnits: () => Promise<Units>,
  readBell: () => Promise<Bell>,
): (
  context: GarmentLoaderContext<Location>,
) => Promise<{ detail: Detail; units: Units; bell: Bell }> {
  return async ({ params, location }) => {
    await gate(location);
    const [detail, units, bell] = await Promise.all([
      readDetail(params.itemId),
      readUnits(),
      readBell(),
    ]);
    return { detail, units, bell };
  };
}
