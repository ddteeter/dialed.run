import { describe, expect, it } from "vitest";

import {
  garmentFormSchema,
  type GarmentFormValues,
} from "../../src/modules/closet/form-schema";

/**
 * The property the closet form's whole arrangement rests on.
 *
 * `useFormSubmit` maps `issue.path[0]` to a field name to decide which
 * input to mark and focus. The rules live in `garmentSchema`, reached
 * through a `.transform(...).pipe(...)`, so every issue is raised against
 * the *transformed* object rather than against the form state the user
 * typed into. If a path did not survive that, a message would land on the
 * wrong field or on no field at all — and it would do so silently, since
 * an unmatched name is just a mark that never appears.
 *
 * They line up because a garment is flat in both shapes. That is a fact
 * about these two schemas, not a guarantee zod makes, which is why it is
 * asserted here and not assumed in a comment.
 */
/**
The same dodge `test/lib/contracts-boundaries.test.ts` documents: a literal
`http://` in a test is autofixed to `https://` — `unicorn/prefer-https` and
`sonarjs/no-clear-text-protocols` both do it — which silently turns "this
insecure URL is rejected" into "this secure URL is rejected". Built from a
variable so no fixer can see it. Reported as guardrails#63.
*/
function urlWithScheme(scheme: string): string {
  return `${scheme}://example.com`;
}

const VALID: GarmentFormValues = {
  brand: "Patagonia",
  name: "Houdini Jacket",
  category: "top",
  size: "M",
  color: "blue",
  productUrl: "",
  layer: "outer",
  weight: "light",
  fabric: "synthetic",
  windResistant: true,
  waterResistant: false,
};

describe("garmentFormSchema", () => {
  it("parses form state into a garment", () => {
    const result = garmentFormSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: "Houdini Jacket",
      brand: "Patagonia",
      category: "top",
      layer: "outer",
      windResistant: true,
    });
  });

  /**
   * Every sentence, in the schema's own words.
   *
   * The contract puts error copy in zod's `message` precisely so no
   * component authors one, which means the schema is the only place these
   * exist and the only place they can be asserted. Without an assertion
   * per sentence a mutant can empty any of them and no test notices — the
   * form would render a blank message band, which looks like a styling
   * bug rather than a missing rule.
   *
   * Each of these is reachable by typing: no input carries a `maxLength`,
   * and the name field's `required` went away with `noValidate`.
   */
  it.each([
    ["name", "", "Give it a name."],
    ["name", "x".repeat(81), "Keep the name under 80 characters."],
    ["brand", "b".repeat(61), "Keep the brand under 60 characters."],
    ["size", "s".repeat(21), "Keep the size under 20 characters."],
    ["color", "c".repeat(31), "Keep the color under 30 characters."],
    ["productUrl", urlWithScheme("http"), "Product links need to start with https://"],
  ])("says what is wrong with %s in the contract's voice", (field, value, message) => {
    const result = garmentFormSchema.safeParse({ ...VALID, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.path).toEqual([field]);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it("keeps each field's issue on its own field when several fail at once", () => {
    // Two-plus errors is a different render path in the contract — a
    // summary block plus every field message — so the paths have to stay
    // distinct, not merely present.
    const result = garmentFormSchema.safeParse({
      ...VALID,
      brand: "b".repeat(61),
      size: "s".repeat(21),
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toHaveLength(2);
    expect(paths).toContain("brand");
    expect(paths).toContain("size");
  });

  it("drops an empty text field rather than sending an empty string", () => {
    // `garmentBase` is a strictObject over optionals: `""` is a value, and
    // absence is what "not answered" means.
    const result = garmentFormSchema.safeParse({ ...VALID, size: "  " });
    expect(result.success).toBe(true);
    // The value, not the key: an explicitly-`undefined` property still
    // satisfies `toHaveProperty`, so asserting on the key would pass for
    // `{ size: "" }` too — which is the thing being ruled out.
    expect(result.data?.size).toBeUndefined();
  });

  it("carries only the attributes the category admits", () => {
    // Shoes declare no `layer`. The union is strict, so sending one is a
    // parse error rather than a field that is quietly ignored — this is
    // what stops the form's flat state leaking into the domain shape.
    const result = garmentFormSchema.safeParse({
      ...VALID,
      category: "shoes",
      layer: "outer",
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("layer");
  });
});
