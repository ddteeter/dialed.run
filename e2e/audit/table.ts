/**
 * One JSON data table under `./data/`, parsed strictly against its shape
 * when the module that names it loads: a key the shape does not know, or a
 * missing one, fails the import (design 205, "Seeded data").
 */
import { z } from "zod";

export function table<Shape extends z.ZodRawShape>(
  json: unknown,
  shape: Shape,
) {
  return z.strictObject(shape).parse(json);
}
