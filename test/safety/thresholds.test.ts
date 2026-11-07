import { describe, expect, it } from "vitest";

import {
  imageCategories,
  moderationThresholds,
  parseThresholds,
  photoThresholds,
  reportersToHide,
  screenPhoto,
  thresholdsAnomaly,
  type ModerationThresholds,
} from "../../src/modules/safety";
import {
  fewestReportersToHide,
  moderationThresholdsSchema,
} from "../../src/modules/safety/thresholds";
import { reportReasons } from "../../src/modules/safety/contracts";

const byName = (a: string, b: string) => a.localeCompare(b);

/**
 * The moderation thresholds, read from config (design 183). Every number
 * here is invented: production's are not in the repo, and nothing in a
 * test may pin them.
 */
const INVENTED: ModerationThresholds = {
  reports: {
    explicit: 4,
    intimate: 1,
    harassment: 5,
    spam: 6,
    not_theirs: 7,
    other: 8,
  },
  photos: {
    sexual: 0.95,
    violence: 0.94,
    "violence/graphic": 0.93,
    "self-harm": 0.92,
    "self-harm/intent": 0.91,
    "self-harm/instructions": 0.9,
  },
};

describe("parsing the config", () => {
  it("reads a whole, well-formed config", () => {
    expect(parseThresholds(JSON.stringify(INVENTED))).toStrictEqual(INVENTED);
  });

  it("is nothing when unset, empty or not a string", () => {
    expect(parseThresholds(undefined)).toBeUndefined();
    expect(parseThresholds("")).toBeUndefined();
    expect(parseThresholds(3)).toBeUndefined();
  });

  it("is nothing for text that is not JSON", () => {
    expect(parseThresholds("{reports:")).toBeUndefined();
  });

  it("is nothing for a config missing a reason or a category", () => {
    const fewer = Object.fromEntries(
      Object.entries(INVENTED.reports).filter(([reason]) => reason !== "other"),
    );
    expect(
      parseThresholds(JSON.stringify({ ...INVENTED, reports: fewer })),
    ).toBeUndefined();
    const photos = Object.fromEntries(
      Object.entries(INVENTED.photos).filter(
        ([category]) => category !== "sexual",
      ),
    );
    expect(
      parseThresholds(JSON.stringify({ ...INVENTED, photos })),
    ).toBeUndefined();
  });

  it("is nothing for a key it does not know", () => {
    expect(
      parseThresholds(JSON.stringify({ ...INVENTED, extra: {} })),
    ).toBeUndefined();
  });

  it("needs at least one whole reporter", () => {
    for (const bad of [0, 1.5]) {
      const reports = { ...INVENTED.reports, spam: bad };
      expect(
        parseThresholds(JSON.stringify({ ...INVENTED, reports })),
      ).toBeUndefined();
    }
  });

  it("needs a hold score above 0 and at most 1", () => {
    for (const bad of [0, 1.01]) {
      const photos = { ...INVENTED.photos, sexual: bad };
      expect(
        parseThresholds(JSON.stringify({ ...INVENTED, photos })),
      ).toBeUndefined();
    }
    const top = { ...INVENTED.photos, sexual: 1 };
    expect(
      parseThresholds(JSON.stringify({ ...INVENTED, photos: top }))?.photos
        .sexual,
    ).toBe(1);
  });

  it("names every reason and every category, and nothing else", () => {
    const shape = moderationThresholdsSchema.shape;
    expect(Object.keys(shape)).toStrictEqual(["reports", "photos"]);
    expect(Object.keys(INVENTED.reports).toSorted(byName)).toStrictEqual(
      reportReasons.map((reason) => reason.value).toSorted(byName),
    );
    expect(Object.keys(INVENTED.photos).toSorted(byName)).toStrictEqual(
      [...imageCategories].toSorted(byName),
    );
  });
});

describe("the Worker's own config", () => {
  it("is the test environment's, read through the env", () => {
    // `test/wrangler.test.jsonc` sets invented values; that they parse is
    // what every other safety test stands on.
    const own = moderationThresholds();
    expect(own).toBeDefined();
    expect(photoThresholds(own)).toStrictEqual(own?.photos);
    expect(reportersToHide("intimate", own)).toBe(own?.reports.intimate);
  });
});

describe("failing closed", () => {
  it("hides on the first report for every reason when the config is missing", () => {
    for (const { value } of reportReasons) {
      expect(reportersToHide(value, undefined)).toBe(1);
    }
    expect(fewestReportersToHide(["spam", "other"], undefined)).toBe(1);
  });

  it("has no hold scores to screen against", () => {
    expect(photoThresholds(undefined)).toBeUndefined();
  });

  it("defers a photo rather than screening it, without asking the classifier", async () => {
    let asked = 0;
    const outcome = await screenPhoto(
      {
        scope: "entry",
        photoId: "01PHOTO",
        bytes: new Uint8Array([1]),
        contentType: "image/jpeg",
      },
      () => {
        asked += 1;
        return Promise.reject(new Error("should not be asked"));
      },
      () => void 0,
    );
    expect(outcome).toBe("deferred");
    expect(asked).toBe(0);
  });

  it("says so in the hourly sweep, and says nothing once it is right", () => {
    expect(thresholdsAnomaly(undefined)).toBe(
      "MODERATION_THRESHOLDS is unset or malformed: every report hides at once and photo screening is paused",
    );
    expect(thresholdsAnomaly(INVENTED)).toBeUndefined();
    expect(thresholdsAnomaly(moderationThresholds())).toBeUndefined();
  });
});

describe("reading a config", () => {
  it("takes each reason's own count", () => {
    expect(reportersToHide("explicit", INVENTED)).toBe(4);
    expect(reportersToHide("other", INVENTED)).toBe(8);
  });

  it("takes the least of the reasons asked about", () => {
    expect(fewestReportersToHide(["spam", "harassment"], INVENTED)).toBe(5);
    expect(fewestReportersToHide(["other"], INVENTED)).toBe(8);
  });

  it("hands screening the configured hold scores", () => {
    expect(photoThresholds(INVENTED)).toBe(INVENTED.photos);
  });
});
