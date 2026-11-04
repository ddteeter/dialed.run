import { expect, test } from "../support/a11y";
import { storageStateFor } from "../support/accounts";
import {
  closetUserId,
  removeSeededGarment,
  seedRoundTwentyTwoGarment,
} from "../conformance/closet-seed";
import type { SeededGarment } from "../conformance/closet-seed";

/**
 * Editing a garment opens the form filled from the garment. The closet
 * demo adds and retires; this is the screen between, which the a11y
 * fixture checks like any other.
 */
test.use({ storageState: storageStateFor("closet") });

const seeded: { garment?: SeededGarment } = {};

test.beforeAll(async () => {
  seeded.garment = await seedRoundTwentyTwoGarment(await closetUserId());
});

test.afterAll(async () => {
  if (seeded.garment !== undefined) await removeSeededGarment(seeded.garment);
});

test("the edit form opens filled from the garment", async ({ page }) => {
  const garment = seeded.garment;
  if (garment === undefined) throw new Error("the garment was not seeded");
  await page.goto(`/closet/edit/${garment.itemId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: /^Edit /u }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /save/iu })).toBeVisible();
});
