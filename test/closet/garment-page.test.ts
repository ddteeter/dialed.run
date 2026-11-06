import { describe, expect, it } from "vitest";

import type { Units } from "../../src/lib/contracts";
import { garmentLoader } from "../../src/modules/closet/garment-page";

const FAHRENHEIT: Units = { temp: "f", distance: "mi" };
const AT_DETAIL = { params: { itemId: "01ITEM" }, location: "/closet/01ITEM" };

describe("garmentLoader", () => {
  it("answers the piece it was asked for and the viewer's units", async () => {
    const asked: string[] = [];
    const load = garmentLoader(
      () => Promise.resolve(),
      (itemId) => {
        asked.push(itemId);
        return Promise.resolve({ id: itemId });
      },
      () => Promise.resolve(FAHRENHEIT),
    );

    await expect(load(AT_DETAIL)).resolves.toStrictEqual({
      detail: { id: "01ITEM" },
      units: FAHRENHEIT,
    });
    expect(asked).toStrictEqual(["01ITEM"]);
  });

  it("passes the location to the gate and reads nothing until it opens", async () => {
    const events: string[] = [];
    const load = garmentLoader(
      (location: string) => {
        events.push(`gate ${location}`);
        return Promise.reject(new Error("signed out"));
      },
      () => {
        events.push("detail");
        return Promise.resolve("piece");
      },
      () => {
        events.push("units");
        return Promise.resolve(FAHRENHEIT);
      },
    );

    await expect(load(AT_DETAIL)).rejects.toThrow(Error);
    await expect(load(AT_DETAIL)).rejects.toThrow("signed out");
    expect(events).toStrictEqual([
      "gate /closet/01ITEM",
      "gate /closet/01ITEM",
    ]);
  });

  it("asks for the units before the piece has come back", async () => {
    let isUnitsAsked = false;
    const detail = Promise.withResolvers<string>();
    const page = garmentLoader(
      () => Promise.resolve(),
      () => detail.promise,
      () => {
        isUnitsAsked = true;
        return Promise.resolve(FAHRENHEIT);
      },
    )(AT_DETAIL);

    // Past the gate's own await, with the piece still outstanding.
    await Promise.resolve();
    expect(isUnitsAsked).toBe(true);
    detail.resolve("01ITEM");
    await expect(page).resolves.toStrictEqual({
      detail: "01ITEM",
      units: FAHRENHEIT,
    });
  });
});
