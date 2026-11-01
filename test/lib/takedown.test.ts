import { describe, expect, it } from "vitest";

import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  SIGNATURE_MAX,
  TAKEDOWN_COPY,
  takedownRequestSchema,
  takedownSearchSchema,
  takedownSubjectOf,
} from "../../src/lib/contracts/takedown";

/**
`/takedown`'s contract (design 136, D-117).
*/
const ENTRY = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const PHOTO = "01JZYXWVTSRQPNMKJHGFEDCBA9";
const RUNNER = "01J0000000000000000000000A";
const KEY = "01J1111111111111111111111B";

const valid = {
  email: "sam@example.com",
  signature: "Sam Runner",
  location: `https://dialed.run/feed/entry/${ENTRY}`,
  description: "",
  isAttested: true,
  idempotencyKey: KEY,
};

function messages(field: string, value: unknown): string[] | undefined {
  return takedownRequestSchema
    .safeParse({ ...valid, [field]: value })
    .error?.issues.map((issue) => issue.message);
}

describe("the request form", () => {
  it("takes a complete request", () => {
    expect(takedownRequestSchema.parse(valid)).toStrictEqual(valid);
  });

  it("names the fix for each missing part, in its own words", () => {
    expect(messages("email", "")).toStrictEqual([TAKEDOWN_COPY.email]);
    expect(messages("email", "sam")).toStrictEqual([TAKEDOWN_COPY.emailShape]);
    expect(messages("signature", "  ")).toStrictEqual([
      TAKEDOWN_COPY.signature,
    ]);
    expect(messages("location", " ")).toStrictEqual([TAKEDOWN_COPY.location]);
    expect(messages("isAttested", false)).toStrictEqual([TAKEDOWN_COPY.attest]);
  });

  it("holds each field to its length, at the bound", () => {
    expect(messages("signature", "a".repeat(SIGNATURE_MAX))).toBeUndefined();
    expect(messages("signature", "a".repeat(SIGNATURE_MAX + 1))).toStrictEqual([
      TAKEDOWN_COPY.signatureLong,
    ]);
    expect(messages("location", "a".repeat(LOCATION_MAX))).toBeUndefined();
    expect(messages("location", "a".repeat(LOCATION_MAX + 1))).toStrictEqual([
      TAKEDOWN_COPY.locationLong,
    ]);
    expect(
      messages("description", "a".repeat(DESCRIPTION_MAX)),
    ).toBeUndefined();
    expect(
      messages("description", "a".repeat(DESCRIPTION_MAX + 1)),
    ).toStrictEqual([TAKEDOWN_COPY.descriptionLong]);
  });

  it("trims the name and the link", () => {
    expect(
      takedownRequestSchema.parse({
        ...valid,
        signature: "  Sam Runner ",
        location: " https://x.test/a ",
      }),
    ).toMatchObject({ signature: "Sam Runner", location: "https://x.test/a" });
  });

  it("needs a key minted by the form", () => {
    expect(
      takedownRequestSchema.safeParse({ ...valid, idempotencyKey: "x" })
        .success,
    ).toBe(false);
  });

  it("says its words", () => {
    expect(TAKEDOWN_COPY).toStrictEqual({
      email: "Enter an email address we can reach you at.",
      emailShape: "That does not look like an email address.",
      signature: "Type your full name as your signature.",
      signatureLong: "Keep your name under 120 characters.",
      location: "Paste the link to the image, or say where it is.",
      locationLong: "Keep this under 2000 characters.",
      descriptionLong: "Keep this under 1000 characters.",
      attest: "Confirm the statement to send the request.",
    });
  });
});

describe("reading a pasted link", () => {
  it("finds a shared kit, on any host, with or without a trailing slash", () => {
    const kit = { subjectType: "entry", subjectId: ENTRY, entryId: ENTRY };
    expect(
      takedownSubjectOf(`https://dialed.run/feed/entry/${ENTRY}`),
    ).toStrictEqual(kit);
    expect(
      takedownSubjectOf(`https://preview.example/feed/entry/${ENTRY}/`),
    ).toStrictEqual(kit);
    expect(
      takedownSubjectOf(`https://dialed.run/feed/entry/${ENTRY}?from=share`),
    ).toStrictEqual(kit);
  });

  it("finds a public kit by its /kit link (round 41 #86c)", () => {
    const kit = { subjectType: "entry", subjectId: ENTRY, entryId: ENTRY };
    expect(takedownSubjectOf(`https://dialed.run/kit/${ENTRY}`)).toStrictEqual(
      kit,
    );
    expect(
      takedownSubjectOf(`https://app.dialed.run/kit/${ENTRY}/`),
    ).toStrictEqual(kit);
    expect(
      takedownSubjectOf(`https://dialed.run/kit/not-a-ulid`),
    ).toBeUndefined();
    expect(
      takedownSubjectOf(`https://dialed.run/x/kit/${ENTRY}`),
    ).toBeUndefined();
    expect(
      takedownSubjectOf(`https://dialed.run/feed/kit/${ENTRY}`),
    ).toBeUndefined();
    expect(takedownSubjectOf(`https://dialed.run/k/${ENTRY}`)).toBeUndefined();
  });

  it("finds a photo and the kit it belongs to", () => {
    expect(
      takedownSubjectOf(
        `https://dialed.run/feed/photo/entries/${RUNNER}/${ENTRY}/${PHOTO}`,
      ),
    ).toStrictEqual({ subjectType: "photo", subjectId: PHOTO, entryId: ENTRY });
  });

  it("finds nothing in a link that is not one of ours", () => {
    expect(
      takedownSubjectOf("https://example.com/some/image.jpg"),
    ).toBeUndefined();
    expect(
      takedownSubjectOf(`https://dialed.run/feed/entry/not-a-ulid`),
    ).toBeUndefined();
    expect(
      takedownSubjectOf(`https://dialed.run/feed/entry/${ENTRY}/more`),
    ).toBeUndefined();
    expect(
      takedownSubjectOf(`https://dialed.run/x/feed/entry/${ENTRY}`),
    ).toBeUndefined();
    expect(
      takedownSubjectOf(
        `https://dialed.run/feed/photo/entries/${RUNNER}/bad/${PHOTO}`,
      ),
    ).toBeUndefined();
    expect(
      takedownSubjectOf(
        `https://dialed.run/feed/photo/entries/${RUNNER}/${ENTRY}/bad`,
      ),
    ).toBeUndefined();
    expect(
      takedownSubjectOf(
        `https://dialed.run/feed/photo/entries/${RUNNER}/${ENTRY}/${PHOTO}/x`,
      ),
    ).toBeUndefined();
    expect(
      takedownSubjectOf(
        `https://dialed.run/x/feed/photo/entries/${RUNNER}/${ENTRY}/${PHOTO}`,
      ),
    ).toBeUndefined();
  });

  it("finds nothing in words", () => {
    expect(takedownSubjectOf("a photo on someone's profile")).toBeUndefined();
    expect(takedownSubjectOf(`/feed/entry/${ENTRY}`)).toBeUndefined();
  });
});

describe("takedownSearchSchema", () => {
  it("keeps a link handed in the URL", () => {
    expect(
      takedownSearchSchema.parse({
        location: `https://dialed.run/kit/${ENTRY}`,
      }),
    ).toStrictEqual({ location: `https://dialed.run/kit/${ENTRY}` });
  });

  it("is empty for a plain visit", () => {
    expect(takedownSearchSchema.parse({})).toStrictEqual({});
  });

  it("drops a value it cannot use rather than failing the page", () => {
    expect(takedownSearchSchema.parse({ location: 5 })).toStrictEqual({
      location: undefined,
    });
    expect(
      takedownSearchSchema.parse({ location: "x".repeat(LOCATION_MAX + 1) }),
    ).toStrictEqual({ location: undefined });
    expect(
      takedownSearchSchema.parse({ location: "x".repeat(LOCATION_MAX) }),
    ).toStrictEqual({ location: "x".repeat(LOCATION_MAX) });
  });
});
