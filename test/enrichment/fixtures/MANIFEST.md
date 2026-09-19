# Fixture manifest

Each fixture is the **single text node** a real page carried its fabric
composition in, kept verbatim — entities, escapes and all — and wrapped in
a `<p>`. Nothing else from the page is stored.

That is deliberate. These are copyrighted marketing pages and this repo is
public, so the fixture is the smallest thing that carries the evidence: the
phrasing a shop actually uses. The `sha256` is of the full page as fetched,
so a fragment can be re-derived and checked against the original.

One exception: `rabbit-chaser-track-pant` carries its composition inside a
JSON _attribute_, so tag-splitting yields one enormous pseudo-node. That
fixture is a bounded window of it — still the page's own bytes, escapes
intact, and the reason `\u0026amp;amp;` is a case this suite covers.

**Two were re-cut on 2026-09-14**, when the prose search was retired and
these stopped testing a parser and started testing the prompt. Both had
been trimmed to what the old search could see, which is the wrong window
now:

- `rabbit-chaser-track-pant` carried only the first of the garment's three
  labelled sections — the very thing the old pass got wrong. It now carries
  all three.
- `soar-run-shorts` was **empty**, captured as "the page that states no
  composition". It says `Shell 88% PA 12% EL`; the old pass could not see
  it because `fibres.ts` has no abbreviations, and the design doc repeated
  that mistake as a claim about the page. It now carries the real text.

| fixture                        | source                                                                    | fetched    | page sha256        | composition                                                        |
| ------------------------------ | ------------------------------------------------------------------------- | ---------- | ------------------ | ------------------------------------------------------------------ |
| `ciele-ortshirt`               | https://www.cieleathletics.com/products/ortshirt-wwm026-trooper           | 2026-09-13 | `7307867b7f921643` | `composition : 100% recycled cotton`                               |
| `districtvision-cordura-socks` | https://districtvision.com/products/cordura-socks-olive                   | 2026-09-13 | `218bb4e138bc3925` | `Fabric composition: 55% Cotton, 43% Nylo`                         |
| `janji-merino-tee`             | https://www.janji.com/products/ms-repeat-merino-tech-tee                  | 2026-09-13 | `f07a630d2a21a627` | `47% 17.5μ merino wool, 38% 37.5® nylon, `                         |
| `pathprojects-shell-jacket`    | https://pathprojects.com/products/graves-px-shell-jacket-1-0              | 2026-09-13 | `743bee49ca559f56` | `Toray Primeflex™: 100% polyester with me`                         |
| `rabbit-chaser-track-pant`     | https://runinrabbit.com/products/chaser-track-pant-mens-4                 | 2026-09-14 | `0407e79bcbbbcf7a` | all three sections, from `PacerWeaveTM body: 91%` to `12% Spandex` |
| `satisfy-mothtech-tee`         | https://www.satisfyrunning.com/products/mothtech-t-shirt-agedblack-1      | 2026-09-13 | `785623c2b1cba05b` | `100% organic cotton from Portugal.`                               |
| `soar-run-shorts`              | https://www.soarrunning.com/products/ss5m-blk1-run-shorts-black           | 2026-09-14 | `c9ceb245de1fdba0` | `Shell 88% PA 12% EL` / `94% PA 6% EL`                             |
| `soar-wooltech-half-tights`    | https://www.soarrunning.com/products/ss22m-blk-wooltech-half-tights-black | 2026-09-13 | `aa3b09c0df7596c4` | `A lightweight woven fabric places a 24% `                         |
