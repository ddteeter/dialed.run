/**
 * Design deltas are one file per entry (#875). `docs/design-deltas.md` is
 * the archive through wave 15, and every lane appending to it made each
 * merge conflict the next PR. A section appended there fails here, with a
 * pointer to the folder it belongs in.
 *
 * The archive is pinned by its hash. An edit to it that is genuinely
 * needed (a broken link, say) updates `ARCHIVE_SHA256` in the same PR and
 * says why in the PR body. A new entry never does.
 *
 * In the `node` project because it reads the files from disk.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ARCHIVE = "docs/design-deltas.md";
const FOLDER = "docs/design-deltas";
const ARCHIVE_SHA256 =
  "918722b7b9cefda1f65ac34ec6c21d763f84518a72ad75d6e844f7cc62f3ae91";

/**
 * `<design number>-<slug>.md` for a lane's section, `round-<N>.md` for a
 * Design round's rulings (`docs/design-deltas/README.md`).
 */
const ENTRY_NAME = /^(?:\d{3,}-[a-z0-9]+(?:-[a-z0-9]+)*|round-\d+)\.md$/u;

describe("design deltas", () => {
  it("leaves the archive as it was frozen", () => {
    const hash = createHash("sha256")
      .update(readFileSync(ARCHIVE))
      .digest("hex");

    expect(
      hash,
      `${ARCHIVE} changed. New entries go in ${FOLDER}/, one file each (see its README.md).`,
    ).toBe(ARCHIVE_SHA256);
  });

  it("names each entry by its design number or its round", () => {
    const misnamed = readdirSync(FOLDER).filter(
      (name) => name !== "README.md" && !ENTRY_NAME.test(name),
    );

    expect(misnamed).toStrictEqual([]);
  });

  it("opens each entry with its section heading", () => {
    const headless = readdirSync(FOLDER)
      .filter((name) => name !== "README.md")
      .filter(
        (name) => !readFileSync(`${FOLDER}/${name}`, "utf8").startsWith("## "),
      );

    expect(headless).toStrictEqual([]);
  });
});
