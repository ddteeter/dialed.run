/**
 * Garments — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 *
 * The account forms (sign-in, sign-up, the handle) sit here because they
 * sat under this section heading in the one file this was split from, and
 * the split moved code without rearranging it.
 */
import { z } from "zod";

import { ACCESS_NOTE_MAX, IS_INVITE_ONLY, inviteCodeField } from "./access";
import { birthDateField } from "./age";
import { httpsUrlSchema } from "./common";

// ---- Garments: discriminated union on category ----------------------------

export const garmentCategories = [
  "top",
  "bottom",
  "headwear",
  "neckwear",
  "gloves",
  "socks",
  "shoes",
  "accessory",
] as const;
/**
 * The words a category goes by on screen.
 *
 * Here rather than in `GarmentForm`, because it was there and P2.5 needs
 * the same words: design's Z ruling makes a generic garment's subtitle
 * `type ?? categoryLabel + " · GENERIC"`, so the naming screen and the add
 * form must agree on what a `neckwear` is called. A second copy is how one
 * screen ends up saying "Neck" and the other "Neckwear" — the same rival
 * truth `uiGroupLabels` below already exists to prevent.
 */
export const garmentCategoryLabels = {
  top: "Top",
  bottom: "Bottom",
  headwear: "Headwear",
  neckwear: "Neckwear",
  gloves: "Gloves",
  socks: "Socks",
  shoes: "Shoes",
  accessory: "Accessory",
} as const satisfies Record<(typeof garmentCategories)[number], string>;

/**
 * The thirteen colour names, in their two classes — design round 11 §AH.
 *
 * **The classes are the source and the enum is derived**, because the rule
 * keys off the class and a hand-written second list is what drifts. §AH's
 * own rule 01: *"Two classes. Neutral: black, white, grey, navy, brown,
 * beige. Colour: red, orange, yellow, green, blue, purple, pink. Thirteen
 * names, locked; no 'multi', no 'other'."*
 *
 * Berlin-Kay's eleven, plus navy and beige "because that's what's on the
 * hang tag". Hi-viz is deliberately **not** a fourteenth: it is not a
 * colour, it is a reason, and `garmentVisibilitySchema` below holds it.
 *
 * The Call's tiebreak that reads these — the name rule and the OKLCH
 * refinement — is Epic 200 and is not built. What ships is collection and
 * display.
 */
export const neutralColorNames = [
  "black",
  "white",
  "grey",
  "navy",
  "brown",
  "beige",
] as const;
export const chromaticColorNames = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;

/**
 * The thirteen as one ordered tuple — the single list everything else
 * reads, including `wardrobe_items.color_name`'s drizzle enum.
 *
 * Exported as the tuple rather than only as a schema because `text(…, {
 * enum })` wants the values and cannot take a zod type. Before this, the
 * schema column spelled all thirteen out again and nothing compared the
 * two: adding a fourteenth name here would have left the column silently
 * accepting twelve.
 */
export const colorNames = [
  ...neutralColorNames,
  ...chromaticColorNames,
] as const;

export const colorNameSchema = z.enum(colorNames);
export type ColorName = z.infer<typeof colorNameSchema>;

/**
 * Which class a name belongs to, read off the arrays above rather than
 * written a second time.
 *
 * Neutrals pair with anything; two *different* chromatic names are what
 * fails a kit. Nothing in v1 calls this — Epic 200 does — but the
 * classification is part of the contract the names are collected under,
 * and deriving it here is what stops the Call lane restating the split.
 */
export function colorClass(name: ColorName): "neutral" | "chromatic" {
  return (neutralColorNames as readonly string[]).includes(name)
    ? "neutral"
    : "chromatic";
}

/**
 * A six-digit hex, lowercased, with the `#`.
 *
 * Level 2 of §AH, and optional at both levels: a runner who gives only a
 * name gets a coarser Call, not a different one. Three-digit shorthand is
 * rejected rather than expanded — the field is filled by sampling a photo
 * or by pasting what a brand published, and neither produces `#abc`.
 */
export const colorHexSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, "Use a six-digit hex like #1f2a44.");

/**
 * How much a garment is built to be seen — §AH's VISIBILITY attribute.
 *
 * **Not `visibility`**, which `wardrobe_items` already has and which means
 * the moderation state (`ok` / `pending` / `pass` / `flagged` /
 * `hidden_pending_review`, written by `closet/service.ts` and owned by
 * lane 106). Two facts, one word, one table: naming this one `visibility`
 * would have overwritten a trust-and-safety field and nothing would have
 * failed loudly. The artboard's label still says VISIBILITY; that is
 * raised in `docs/design-deltas.md`.
 *
 * Three values, and all three are load-bearing. §AH rule 04: a `hi_viz`
 * garment is *invisible* to the colour rule — "not Neutral, not Colour,
 * not counted. It's safety because the runner said so, never because a hex
 * is bright." `reflective` is **not** exempt: "the base colour is what
 * shows."
 */
export const garmentVisibilities = ["plain", "reflective", "hi_viz"] as const;

export const garmentVisibilitySchema = z.enum(garmentVisibilities);
export type GarmentVisibility = z.infer<typeof garmentVisibilitySchema>;

export const layerSchema = z.enum(["base", "mid", "outer"]);
export const weightSchema = z.enum(["light", "mid", "heavy"]);
export const fabricSchema = z.enum([
  "synthetic",
  "merino",
  "cotton",
  "blend",
  "down",
]);

/**
 * The sentences are part of the schema, not of whatever renders it.
 *
 * `docs/product.md` §Forms & failure: "Error copy lives in the schema, in
 * zod's `message`. A component authoring its own sentence is the same
 * problem one layer down." Without them a user meets zod's default — the
 * closet form's real output was *"Too small: expected string to have >=1
 * characters"* — and every form that renders this schema would have had to
 * translate it, which is four translations of one rule.
 *
 * Second person, says what to do, no apology. `signUpSchema` below sets
 * the register.
 */
const garmentBase = z.strictObject({
  name: z
    .string()
    .min(1, "Give it a name.")
    .max(80, "Keep the name under 80 characters."),
  brand: z.string().max(60, "Keep the brand under 60 characters.").optional(),
  size: z.string().max(20, "Keep the size under 20 characters.").optional(),
  color: z.string().max(30, "Keep the color under 30 characters.").optional(),
  /**
   * §AH, and additive: the free-text `color` above is the *colourway* the
   * runner typed ("Obsidian") and stays exactly as it was, as the row's
   * caption. These two are the structured reading beside it.
   *
   * Nothing is parsed and nothing is backfilled — mapping "Obsidian" to
   * black is the parser round 5 rejected.
   */
  colorName: colorNameSchema.optional(),
  colorHex: colorHexSchema.optional(),
  visibilityLevel: garmentVisibilitySchema.optional(),
  productUrl: httpsUrlSchema.optional(),
  productId: z.string().optional(),
  estTempLowC: z.number().optional(),
  estTempHighC: z.number().optional(),
});
const layered = garmentBase.extend({
  layer: layerSchema.optional(),
  weight: weightSchema.optional(),
  fabric: fabricSchema.optional(),
  windResistant: z.boolean().optional(),
  waterResistant: z.boolean().optional(),
});
/**
 * Sign-in and sign-up, the two forms with no server function of their own —
 * Better Auth owns the endpoints, so this schema is the *only* validation
 * before the request goes out.
 *
 * Error copy lives here, in zod's `message`, and nowhere else (§Forms &
 * failure, "Error copy lives in the schema"). A component authoring its own
 * sentence is the four-lanes problem in miniature: same rule, four
 * wordings. The copy rules are binding — one sentence, under ten words,
 * sentence case, ends in a period, and it names the fix rather than the
 * rule ("Use at least 10 characters", not "Value too short").
 *
 * Lives in contracts rather than the design's suggested `lib/schemas/`
 * because this file already *is* that module: importable by both sides,
 * importing nothing from a server.
 */
const emailField = z
  .string()
  .min(1, "Enter your email address.")
  .check(z.email("That does not look like an email address."));

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password."),
});

/**
 * The shortest password an account may have (owner, 2026-09-24: ten, as
 * Au1's placeholder says). One number for both sides: this schema reads it
 * so the form says so before the round trip, and `createAuth` hands the
 * same constant to Better Auth as `minPasswordLength` so the server refuses
 * exactly what the form does.
 */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Sign-up asks for email and password only (round 26 #7): the handle is
 * picked at O0, the first onboarding step, so email and Google share one
 * path and a taken handle never shares a screen with "is this email
 * registered?".
 */
const newPasswordField = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.`,
  );

/**
 * With invite-only on (D-39), the code is the form's first field; off, it
 * is not asked for and whatever arrives is ignored. A function so both
 * halves of the flag are testable, the schema below its one reading. The
 * date of birth is asked either way (design 134): the form checks its
 * shape, the server its age.
 */
export function signUpSchemaFor(isInviteOnly: boolean) {
  return z.object({
    inviteCode: isInviteOnly ? inviteCodeField : z.string().optional(),
    birthDate: birthDateField,
    email: emailField,
    password: newPasswordField,
  });
}

export const signUpSchema = signUpSchemaFor(IS_INVITE_ONLY);

/**
 * Au5 · Request access (round 26 #20): an address, and a note if they
 * want to say why. The Turnstile token rides alongside, checked by the
 * server.
 */
export const requestAccessSchema = z.object({
  email: emailField,
  note: z
    .string()
    .max(
      ACCESS_NOTE_MAX,
      `Keep the note under ${String(ACCESS_NOTE_MAX)} characters.`,
    ),
});

/**
 * ACC-4's first step: "Forgot it?" asks for the address the link goes to.
 * The same answer follows whether or not it has an account.
 */
export const resetRequestSchema = z.object({ email: emailField });

/**
ACC-4's second step: the new password, on the same floor as sign-up's.
*/
export const newPasswordSchema = z.object({ password: newPasswordField });

/**
 * ACC-7: the current password proves it is the runner, and the new one
 * meets sign-up's floor.
 */
/**
 * The current password, which a change to the account asks for first
 * (ACC-7, ACC-8). Only present: whether it matches is the server's to say,
 * in `CURRENT_PASSWORD_WRONG`'s words.
 */
const currentPasswordField = z.string().min(1, "Enter your current password.");

/**
 * The server's refusal of a current password, on that field (ACC-7,
 * ACC-8; round 27 #11's wording).
 */
export const CURRENT_PASSWORD_WRONG = "That's not your current password.";

/**
 * How many tries at the current password a runner gets in a window
 * (`auth/password-check.ts` counts them) — here so the refusal below says
 * the limiter's own number.
 */
export const PASSWORD_ATTEMPTS_PER_WINDOW = 5;

/**
 * The same field, once the tries at the password are used up (ACC-8):
 * `clock` is when the next may go, in the runner's own time, with no
 * seconds (round 28 #10's wording).
 */
export function currentPasswordLimited(clock: string): string {
  return `That's ${String(PASSWORD_ATTEMPTS_PER_WINDOW)} wrong tries. You can try again at ${clock}.`;
}

export const changePasswordSchema = z.object({
  currentPassword: currentPasswordField,
  password: newPasswordField,
});

/**
 * ACC-9 (round 27 #14): deleting the account asks for the current
 * password, as every change to the account does. An account with no
 * password proves itself with a fresh Google sign-in instead, and sends
 * none — so the server takes it as optional.
 */
export const accountDeletionInput = z.object({
  currentPassword: z.string().max(1024).optional(),
});

/**
 * `accountDeletionInput`, with the field required — an account with a
 * password proves itself with it, as every change to the account does.
 * Extended rather than a second `z.object()` restating the same key
 * ("derive, don't mirror"): the two floors for one field are the
 * server-side "at most this long" and the client-side "you must type one".
 */
export const accountDeletionSchema = accountDeletionInput.extend({
  currentPassword: currentPasswordField,
});

/**
 * How long a deleted account waits before it is purged (ACC-9; round 27
 * #14: "Deleted after 7 days. Log in before then to keep it.").
 */
export const DELETION_GRACE_S = 7 * 24 * 60 * 60;

/**
 * The server's refusal of a deletion from an account with no password
 * whose Google sign-in is more than ten minutes old (ACC-9; round 27
 * #14): where the password field would be, above "Continue with Google".
 */
export const DELETION_NEEDS_GOOGLE =
  "Sign in with Google again to confirm it's you.";

/**
 * ACC-8: the address the account moves to, once its link is opened, and
 * the current password that proves it is the runner asking.
 */
export const changeEmailSchema = z.object({
  email: emailField,
  currentPassword: currentPasswordField,
});

/**
 * The handle's length bounds (round 26 #7: "3–20 letters, numbers or _").
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/**
 * What a runner typed, as it would be stored: lowercased, without the "@"
 * the field shows in front of it or any space around it. The field applies
 * this as they type ("The field lowercases as you type, so you see what's
 * stored"), and the schema applies it again, so a handle reaching the
 * server by any other road is compared the way the unique index compares.
 */
export function normalizeUsername(typed: string): string {
  return typed.trim().replace(/^@/u, "").toLowerCase();
}

/**
 * A handle (round 26 #7). The two refusals are the board's, one at a time:
 * the shape first, and "can't start with _" only for a handle whose shape
 * is otherwise fine — so `_x` reads the first, not both. Uniqueness and the
 * reserved list are the server's (`modules/account/username.ts`), because
 * only it can know them.
 *
 * No `u` flag: the class is pure ASCII and the pattern has no `.`, `\p{}`
 * or `i`, so the flag changes no match — and an inert argument is a
 * mutant no input can kill.
 */
const USERNAME_SHAPE = new RegExp(
  `^[a-z0-9_]{${String(USERNAME_MIN_LENGTH)},${String(USERNAME_MAX_LENGTH)}}$`,
);

const storedUsername = z
  .string()
  .check(
    z.regex(USERNAME_SHAPE, {
      message: "Use 3–20 letters, numbers or _.",
      abort: true,
    }),
  )
  .refine((handle) => !handle.startsWith("_"), {
    message: "Handles can't start with _.",
  });

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(storedUsername);

export const usernameInput = z.object({ username: usernameSchema });

/**
 * What the moderation check said about a claimed handle (task 126 PR B),
 * as `user_profiles.username_screen` stores it: its three answers, and
 * `checking` while the hourly re-ask holds the row. Here, beside the
 * handle's rule, so the schema and the module read one list.
 */
export const HANDLE_SCREEN_STATES = [
  "clear",
  "flagged",
  "unknown",
  "checking",
] as const;

/**
 * A WGS84 coordinate pair, bounded. Written out four times before this —
 * twice here and twice in `modules/feed/functions.ts` — which is four
 * places to get a sign or a bound wrong, and no way for them to disagree
 * loudly.
 */
export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

/**
 * The specific thing a garment *is*, within its category. A `top` is a
 * singlet or a tee or a half-zip; the category alone cannot tell you, and
 * anything that has to show a garment — an icon, a recommendation, a
 * consensus bucket — needs to know which.
 *
 * The vocabulary is not invented here. It is the design's own: the P2
 * tap-list is a list of these ("SINGLET · SHORT-SLEEVE TEE · MERINO BASE
 * L/S · HALF-ZIP · 5\u2033 SHORTS · TIGHTS · WIND SHELL · BEANIE · BUFF"),
 * and the Icon Pack draws one glyph per entry to render it. So the values
 * are named for the glyphs and a garment's icon *is* its type — an identity
 * function rather than a mapping table anyone could get wrong. A test in
 * `test/garment-fields.test.ts` fails if the two ever drift apart.
 *
 * Display labels stay free text on `name`. "Wind shell" and "Rain jacket"
 * are both `jacket`, told apart by `windResistant`/`waterResistant`;
 * "Mittens" is `gloves`; "Trail shoes" is `shoes`; "Buff" is `neckGaiter`.
 * The type says what shape a thing is, not what it is for.
 *
 * Optional everywhere, because it has to be: every garment written before
 * this column existed has none, and CLAUDE.md law 8 is expand-then-contract.
 * Treat `undefined` as "not known yet", never as a category default.
 */
export const garmentTypesByCategory = {
  // `sportsBra` and `armSleeves` arrived with the Icon Pack marked
  // provisional. They are real tap-list rows on P2 (ARM WARMERS is on the
  // screen), so they ship.
  top: [
    "singlet",
    "tee",
    "longSleeve",
    "halfZip",
    "jacket",
    "vest",
    "sportsBra",
  ],
  bottom: ["shorts", "halfTights", "tights"],
  headwear: ["cap", "beanie", "headband"],
  neckwear: ["neckGaiter"],
  gloves: ["gloves"],
  socks: ["socks"],
  shoes: ["shoes"],
  accessory: ["sunglasses", "armSleeves"],
} as const;

export const garmentSchema = z.discriminatedUnion("category", [
  layered.extend({
    category: z.literal("top"),
    type: z.enum(garmentTypesByCategory.top).optional(),
  }),
  layered.extend({
    category: z.literal("bottom"),
    type: z.enum(garmentTypesByCategory.bottom).optional(),
  }),
  garmentBase.extend({
    category: z.literal("headwear"),
    type: z.enum(garmentTypesByCategory.headwear).optional(),
    weight: weightSchema.optional(),
    fabric: fabricSchema.optional(),
    windResistant: z.boolean().optional(),
  }),
  garmentBase.extend({
    category: z.literal("neckwear"),
    type: z.enum(garmentTypesByCategory.neckwear).optional(),
    weight: weightSchema.optional(),
    fabric: fabricSchema.optional(),
  }),
  garmentBase.extend({
    category: z.literal("gloves"),
    type: z.enum(garmentTypesByCategory.gloves).optional(),
    weight: weightSchema.optional(),
    windResistant: z.boolean().optional(),
    waterResistant: z.boolean().optional(),
  }),
  garmentBase.extend({
    category: z.literal("socks"),
    type: z.enum(garmentTypesByCategory.socks).optional(),
    weight: weightSchema.optional(),
    fabric: fabricSchema.optional(),
  }),
  garmentBase.extend({
    category: z.literal("shoes"),
    type: z.enum(garmentTypesByCategory.shoes).optional(),
    waterResistant: z.boolean().optional(),
  }),
  garmentBase.extend({
    category: z.literal("accessory"),
    type: z.enum(garmentTypesByCategory.accessory).optional(),
  }),
]);
export type Garment = z.infer<typeof garmentSchema>;

/**
 * Closet UI groups — the code form of docs/contracts.md's derived-group
 * table (design screen C). Derived from category x layer, never stored.
 *
 * Here rather than in modules/closet because it is a shared contract with
 * two consumers: the closet renders it and the feed's kit picker groups by
 * it. Lane 104 wrote its own copy for exactly that reason, with a comment
 * saying the predicate table was the shared thing and the code was not —
 * which is how two implementations of one table start.
 */
export const uiGroups = [
  "tops",
  "bottoms",
  "outer",
  "hands_head",
  "shoes",
  "socks_extras",
] as const;
export type UiGroup = (typeof uiGroups)[number];

/**
 * Group headings, as they appear on screen C. Here rather than in a lane
 * because the closet renders them and the feed's kit picker renders the
 * same headings over the same rows — a second copy would let one screen
 * rename a group and the other not.
 */
export const uiGroupLabels: Record<UiGroup, string> = {
  tops: "Tops",
  bottoms: "Bottoms",
  outer: "Outer",
  hands_head: "Hands / head",
  shoes: "Shoes",
  socks_extras: "Socks / extras",
};

/**
 * Which group an item falls in. A product judgement keyed by category, not
 * a restatement of the garment schema — headwear, neckwear and gloves
 * share a group because that is how the screen is laid out, and nothing in
 * the union says so. So this is a table, deliberately, and the
 * derive-don't-mirror rule does not apply to it.
 */
export function uiGroupFor(
  category: Garment["category"],
  // `null` because a drizzle row gives null for an unset column, and
  // `undefined` because a parsed `Garment` gives that for the same fact.
  // Both mean "no layer" and the function does not care which.
  layer: z.infer<typeof layerSchema> | null | undefined,
): UiGroup {
  if (layer === "outer") return "outer";
  switch (category) {
    case "top": {
      return "tops";
    }
    case "bottom": {
      return "bottoms";
    }
    case "headwear":
    case "neckwear":
    case "gloves": {
      return "hands_head";
    }
    case "shoes": {
      return "shoes";
    }
    case "socks":
    case "accessory": {
      return "socks_extras";
    }
  }
}

/**
 * Performance buckets (D-27): how an item is doing, derived from verdict
 * history. Shared so the zod filter enum and the TypeScript type cannot
 * drift — they were two independent lists before.
 */
export const performanceBuckets = [
  "most_dialed",
  "never_worked",
  "untested",
  "retire_candidate",
] as const;
export const performanceBucketSchema = z.enum(performanceBuckets);
export type PerformanceBucket = (typeof performanceBuckets)[number];
