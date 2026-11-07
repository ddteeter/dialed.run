/**
 * The corrections states the journey (`corrections.demo.spec.ts`) walks
 * past: WRONG?'s input for each kind of field, its refusal of an empty
 * send, a field that opens with what was sent (R48·129c, e), and the
 * Desk's "N more runners", Decline with a reason, and the refused name
 * (R48·130).
 *
 * Needs `ADMIN_USER_IDS=e2e-desk-operator`, as the journey does.
 */
import { eq, inArray } from "drizzle-orm";

import {
  brands,
  notifications,
  productCorrections,
  products,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { expect, test } from "../support/a11y";
import { hydrated } from "../support/demo";
import { signInAsKnownUser } from "../support/known-user";
import { withLocalDb } from "../support/local-db";
import { signInAsOperator } from "./operator";

const RUNNER_ID = "e2e-corrections-states";
const RUNNER_HANDLE = "states_spotter";

interface Seeded {
  brandId: string;
  productId: string;
  otherProductId: string;
  garmentId: string;
  productName: string;
  otherName: string;
  helperIds: string[];
}

async function seed(): Promise<Seeded> {
  const suffix = String(Date.now()).slice(-8);
  const seeded: Seeded = {
    brandId: newUlid(),
    productId: newUlid(),
    otherProductId: newUlid(),
    garmentId: newUlid(),
    productName: `Rain Shell ${suffix}`,
    otherName: `Storm Shell ${suffix}`,
    helperIds: [newUlid(), newUlid()],
  };
  const now = nowSeconds();
  await withLocalDb(async ({ core }) => {
    await core.insert(brands).values({
      id: seeded.brandId,
      name: "Janji",
      normalized: `janji ${seeded.brandId}`,
    });
    await core.insert(products).values(
      [
        { id: seeded.productId, name: seeded.productName },
        { id: seeded.otherProductId, name: seeded.otherName },
      ].map(({ id, name }) => ({
        id,
        brandId: seeded.brandId,
        name,
        normalizedName: name.toLowerCase(),
        weight: "mid" as const,
        createdBy: RUNNER_ID,
        createdAt: now,
      })),
    );
    await core.insert(wardrobeItems).values({
      id: seeded.garmentId,
      userId: RUNNER_ID,
      category: "top",
      brand: "Janji",
      name: seeded.productName,
      productId: seeded.productId,
      origin: "manual",
      createdAt: now,
    });
    await core.insert(userProfiles).values(
      seeded.helperIds.map((userId, index) => ({
        userId,
        username: `helper${String(index)}_${suffix}`,
      })),
    );
  });
  return seeded;
}

async function cleanUp(seeded: Seeded): Promise<void> {
  await withLocalDb(async ({ core }) => {
    const productIds = [seeded.productId, seeded.otherProductId];
    await core
      .delete(productCorrections)
      .where(inArray(productCorrections.productId, productIds));
    await core
      .delete(notifications)
      .where(inArray(notifications.userId, [RUNNER_ID, ...seeded.helperIds]));
    await core
      .delete(wardrobeItems)
      .where(eq(wardrobeItems.id, seeded.garmentId));
    await core.delete(products).where(inArray(products.id, productIds));
    await core.delete(brands).where(eq(brands.id, seeded.brandId));
    await core
      .delete(userProfiles)
      .where(inArray(userProfiles.userId, seeded.helperIds));
  });
}

test("WRONG? takes each field's own input, and opens a field with what was sent", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(90_000);
  const seeded = await seed();
  try {
    await signInAsKnownUser(page, RUNNER_ID, RUNNER_HANDLE);
    await page.goto(`/closet/${seeded.garmentId}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Wrong?" }).click();
    const sheet = page.getByRole("dialog", { name: "What's wrong with it?" });

    // Nothing picked: refused in place, the field named.
    await sheet.getByRole("button", { name: "Send correction" }).click();
    await expect(sheet.getByRole("radio", { name: "Name" })).toBeVisible();
    await expect(
      sheet.getByRole("textbox", { name: /It should say/u }),
    ).toHaveCount(0);

    await sheet.getByRole("radio", { name: "Link" }).check();
    await expect(
      sheet.getByRole("textbox", { name: "It should say" }),
    ).toHaveAttribute("type", "url");
    await sheet.getByRole("radio", { name: "Wind" }).check();
    await expect(
      sheet.getByRole("group", { name: "It should say" }),
    ).toBeVisible();
    await sheet.getByRole("radio", { name: "Fabric" }).check();
    await expect(
      sheet.getByRole("combobox", { name: "It should say" }),
    ).toBeVisible();

    await sheet.getByRole("radio", { name: "Name" }).check();
    const name = sheet.getByRole("textbox", { name: /It should say/u });
    await name.fill("");
    await sheet.getByRole("button", { name: "Send correction" }).click();
    await expect(sheet.getByText("Type the name.").first()).toBeVisible();
    await name.fill(seeded.otherName);
    await sheet.getByRole("button", { name: "Send correction" }).click();
    await expect(
      page.getByRole("heading", { name: "Thanks. We'll check it." }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Done" }).click();

    // Again: Name opens with what was sent, and says so.
    await page.getByRole("button", { name: "Wrong?" }).click();
    await sheet.getByRole("radio", { name: "Name" }).check();
    await expect(
      sheet.getByRole("textbox", { name: /It should say/u }),
    ).toHaveValue(seeded.otherName);
    await expect(sheet.getByText(/Sending again replaces it\./u)).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "Name" })).toBeChecked();
  } finally {
    await cleanUp(seeded);
  }
});

test("the Desk opens a row's other runners, declines with a reason, and refuses a name the brand has", async ({
  page,
}) => {
  const seeded = await seed();
  try {
    const now = nowSeconds();
    await withLocalDb(async ({ core }) => {
      await core.insert(productCorrections).values([
        // Two runners on one value, so the row has one more to open.
        ...seeded.helperIds.map((userId, index) => ({
          id: newUlid(),
          productId: seeded.productId,
          userId,
          field: "weight" as const,
          value: "light",
          garmentId: seeded.garmentId,
          ...(index === 0 && { note: "It's on the maker's page." }),
          status: "waiting" as const,
          idempotencyKey: newUlid(),
          createdAt: now - 60 * (index + 1),
        })),
        // A name the brand's other product already has.
        {
          id: newUlid(),
          productId: seeded.productId,
          userId: RUNNER_ID,
          garmentId: seeded.garmentId,
          field: "name" as const,
          value: seeded.otherName,
          status: "waiting" as const,
          idempotencyKey: newUlid(),
          createdAt: now - 30,
        },
      ]);
    });
    await signInAsOperator(page);
    await page.goto("/desk/corrections");
    await hydrated(page);
    const title = `Janji · ${seeded.productName}`;

    const weight = page
      .getByRole("article", { name: title })
      .filter({ hasText: /^Weight/u });
    await weight.getByRole("button", { name: "1 more runner" }).click();
    await expect(weight.getByRole("listitem")).toHaveCount(2);
    await weight.getByRole("button", { name: "Decline" }).click();
    await weight
      .getByRole("combobox", { name: "Reason" })
      .selectOption("not_enough");
    await weight.getByRole("button", { name: "Confirm" }).click();
    await expect(weight).toHaveCount(0);

    const renamed = page.getByRole("article", { name: title });
    await renamed.getByRole("button", { name: "Apply" }).click();
    await expect(
      renamed.getByText(
        "Another product of this brand already has that name. Decline it, and look in Duplicates.",
      ),
    ).toBeVisible();
  } finally {
    await cleanUp(seeded);
  }
});
