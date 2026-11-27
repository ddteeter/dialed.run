import { describe, expect, it } from "vitest";

import { kitParagraph } from "../../../src/modules/call/evidence/paragraph";
import type { WarmRunsWorn } from "../../../src/modules/call/evidence/warm-runs";
import { names, piece, result } from "./fixtures";

const band = {
  kind: "personal-band",
  bandFloorC: 5,
  cold: 2,
  dialed: 8,
  warm: 1,
} as const;

function tooMuch(pieceId: string, times: number, bandFloorC = 5) {
  return {
    kind: "personal-flag",
    pieceId,
    bandFloorC,
    flag: "too_much",
    times,
  } as const;
}

const runner = names({ zip: "half-zip", gloves: "gloves", mitts: "mitts" });

describe("kitParagraph", () => {
  it("says both sentences, cold first", () => {
    const zip = piece("zip", "tops", [band]);
    const call = result({
      kit: [zip],
      ranking: [zip, piece("gloves", "hands_head", [tooMuch("gloves", 1)])],
    });
    expect(kitParagraph(call, runner)).toBe(
      "You've been too cold twice in this band. Skip the gloves — too much once in this band.",
    );
  });

  it("says the cold sentence alone", () => {
    const zip = piece("zip", "tops", [{ ...band, cold: 3 }]);
    expect(kitParagraph(result({ kit: [zip], ranking: [zip] }), runner)).toBe(
      "You've been too cold 3 times in this band.",
    );
    const once = piece("zip", "tops", [{ ...band, cold: 1 }]);
    expect(kitParagraph(result({ kit: [once] }), runner)).toBe(
      "You've been too cold once in this band.",
    );
  });

  it("says nothing of the band when no run was cold or warm", () => {
    const zip = piece("zip", "tops", [{ ...band, cold: 0, warm: 0 }]);
    expect(kitParagraph(result({ kit: [zip] }), runner)).toBeUndefined();
  });

  it("says cold on a tie, as the board does", () => {
    const even = piece("zip", "tops", [{ ...band, cold: 2, warm: 2 }]);
    expect(kitParagraph(result({ kit: [even] }), runner)).toBe(
      "You've been too cold twice in this band.",
    );
  });

  it("reads only the band of this hour", () => {
    const other = piece("zip", "tops", [{ ...band, bandFloorC: 10 }, band]);
    expect(kitParagraph(result({ kit: [other] }), runner)).toBe(
      "You've been too cold twice in this band.",
    );
    const elsewhere = piece("zip", "tops", [{ ...band, bandFloorC: 10 }]);
    expect(kitParagraph(result({ kit: [elsewhere] }), runner)).toBeUndefined();
    const flagged = piece("gloves", "hands_head", [tooMuch("gloves", 2, 10)]);
    expect(
      kitParagraph(result({ ranking: [flagged] }), runner),
    ).toBeUndefined();
  });

  it("reads no band's facts when there is no forecast", () => {
    const zip = piece("zip", "tops", [band]);
    expect(
      kitParagraph(result({ bandFloorC: undefined, kit: [zip] }), runner),
    ).toBeUndefined();
  });

  it("skips the loudest too-much the kit left out", () => {
    const call = result({
      ranking: [
        piece("mitts", "hands_head", [tooMuch("mitts", 2)]),
        piece("gloves", "hands_head", [tooMuch("gloves", 3)]),
        piece("zip", "tops", [tooMuch("zip", 2)]),
      ],
    });
    expect(kitParagraph(call, runner)).toBe(
      "Skip the gloves — too much 3 times in this band.",
    );
  });

  it("keeps the first of a tie", () => {
    const call = result({
      ranking: [
        piece("mitts", "hands_head", [tooMuch("mitts", 2)]),
        piece("gloves", "hands_head", [tooMuch("gloves", 2)]),
      ],
    });
    expect(kitParagraph(call, runner)).toBe(
      "Skip the mitts — too much twice in this band.",
    );
  });

  it("never skips a piece the kit chose, nor one it was not enough", () => {
    const zip = piece("zip", "tops", [tooMuch("zip", 4)]);
    const gloves = piece("gloves", "hands_head", [
      { ...tooMuch("gloves", 5), flag: "not_enough" },
      tooMuch("gloves", 1),
    ]);
    expect(
      kitParagraph(result({ kit: [zip], ranking: [zip, gloves] }), runner),
    ).toBe("Skip the gloves — too much once in this band.");
  });

  it("says no skip for a piece with no name", () => {
    const call = result({
      ranking: [piece("anon", "hands_head", [tooMuch("anon", 2)])],
    });
    expect(kitParagraph(call, runner)).toBeUndefined();
  });

  it("says nothing with no facts", () => {
    expect(kitParagraph(result(), runner)).toBeUndefined();
  });
});

const own = (pieceId: string, lowC: number) =>
  ({ kind: "estimate", pieceId, range: { lowC } }) as const;
const worn = (...pieces: WarmRunsWorn["worn"]): WarmRunsWorn => ({
  bandFloorC: 5,
  worn: pieces,
});

describe("the warm line", () => {
  const warmBand = { ...band, cold: 0, warm: 2 };
  const longSleeve = {
    pieceId: "ls",
    group: "tops",
    estimate: { lowC: 5 },
  } as const;
  const vest = { pieceId: "vest", group: "outer" } as const;
  const warmLine = "You've been too warm twice in this band.";

  it("shows when the kit drops a group worn on the warm runs", () => {
    const kit = [piece("ls", "tops", [warmBand, own("ls", 5)])];
    expect(kitParagraph(result({ kit }), runner, worn(longSleeve, vest))).toBe(
      warmLine,
    );
  });

  it("shows when a piece is swapped for a lighter one", () => {
    const kit = [piece("tee", "tops", [warmBand, own("tee", 15)])];
    expect(kitParagraph(result({ kit }), runner, worn(longSleeve))).toBe(
      warmLine,
    );
  });

  it("says nothing of warmth in the same kit", () => {
    const kit = [piece("ls", "tops", [warmBand, own("ls", 5)])];
    expect(
      kitParagraph(result({ kit }), runner, worn(longSleeve)),
    ).toBeUndefined();
  });

  it("says nothing of warmth for the same piece, whatever its estimate now", () => {
    const kit = [piece("ls", "tops", [warmBand, own("ls", 9)])];
    expect(
      kitParagraph(result({ kit }), runner, worn(longSleeve)),
    ).toBeUndefined();
  });

  it("says nothing of warmth in a heavier kit", () => {
    const kit = [piece("ls", "tops", [warmBand, own("ls", 5)])];
    const tee = {
      pieceId: "tee",
      group: "tops",
      estimate: { lowC: 15 },
    } as const;
    expect(kitParagraph(result({ kit }), runner, worn(tee))).toBeUndefined();
    const even = [piece("tee", "tops", [warmBand, own("tee", 5)])];
    expect(
      kitParagraph(result({ kit: even }), runner, worn(longSleeve)),
    ).toBeUndefined();
  });

  it("says nothing of warmth without the fact, or with another band's", () => {
    const kit = [piece("tee", "tops", [warmBand, own("tee", 15)])];
    expect(kitParagraph(result({ kit }), runner)).toBeUndefined();
    expect(
      kitParagraph(result({ kit }), runner, {
        bandFloorC: 10,
        worn: [longSleeve],
      }),
    ).toBeUndefined();
  });

  it("does not call a swap lighter when either range has no low end", () => {
    const bare = [piece("tee", "tops", [warmBand])];
    expect(
      kitParagraph(result({ kit: bare }), runner, worn(longSleeve)),
    ).toBeUndefined();
    const kit = [piece("tee", "tops", [warmBand, own("tee", 15)])];
    expect(
      kitParagraph(
        result({ kit }),
        runner,
        worn({ pieceId: "ls", group: "tops" }),
      ),
    ).toBeUndefined();
    const highOnly = [
      piece("tee", "tops", [
        warmBand,
        { kind: "estimate", pieceId: "tee", range: { highC: 30 } },
      ]),
    ];
    expect(
      kitParagraph(result({ kit: highOnly }), runner, worn(longSleeve)),
    ).toBeUndefined();
  });

  it("finds the estimate behind the piece's other facts", () => {
    const record = {
      kind: "personal-piece",
      pieceId: "tee",
      bandFloorC: 5,
      dialed: 1,
      of: 3,
    } as const;
    const kit = [piece("tee", "tops", [warmBand, record, own("tee", 15)])];
    expect(kitParagraph(result({ kit }), runner, worn(longSleeve))).toBe(
      warmLine,
    );
  });

  it("reads the kit piece's own estimate, not another's", () => {
    const kit = [piece("tee", "tops", [warmBand, own("other", 15)])];
    expect(
      kitParagraph(result({ kit }), runner, worn(longSleeve)),
    ).toBeUndefined();
    const both = [
      piece("tee", "tops", [warmBand, own("other", 1), own("tee", 15)]),
    ];
    expect(kitParagraph(result({ kit: both }), runner, worn(longSleeve))).toBe(
      warmLine,
    );
  });

  it("wins over cold when warm runs outnumber cold ones", () => {
    const kit = [
      piece("tee", "tops", [{ ...band, cold: 1, warm: 3 }, own("tee", 15)]),
    ];
    expect(kitParagraph(result({ kit }), runner, worn(longSleeve))).toBe(
      "You've been too warm 3 times in this band.",
    );
  });

  it("leaves the cold line when warm cannot show", () => {
    const kit = [
      piece("ls", "tops", [{ ...band, cold: 1, warm: 3 }, own("ls", 5)]),
    ];
    expect(kitParagraph(result({ kit }), runner, worn(longSleeve))).toBe(
      "You've been too cold once in this band.",
    );
  });

  it("leaves cold on a tie, even in a lighter kit", () => {
    const kit = [
      piece("tee", "tops", [{ ...band, cold: 2, warm: 2 }, own("tee", 15)]),
    ];
    expect(kitParagraph(result({ kit }), runner, worn(longSleeve))).toBe(
      "You've been too cold twice in this band.",
    );
  });

  it("sits beside a skip", () => {
    const tee = piece("tee", "tops", [warmBand, own("tee", 15)]);
    const call = result({
      kit: [tee],
      ranking: [tee, piece("gloves", "hands_head", [tooMuch("gloves", 1)])],
    });
    expect(kitParagraph(call, runner, worn(longSleeve))).toBe(
      "You've been too warm twice in this band. Skip the gloves — too much once in this band.",
    );
  });
});
