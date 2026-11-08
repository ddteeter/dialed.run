/**
 * `npm run shop-images:delete -- [--remote] [--apply]`: deletes the shop
 * images the enrichment consumer stored before D-176 (design 187, #472).
 *
 * **A dry run unless `--apply` is passed.** Without it the script prints
 * every key it would delete and touches nothing. Read the list, then run
 * it again with `--apply`.
 *
 * **Local unless `--remote` is passed.** Local is the dev server's
 * Miniflare state under `.wrangler/state`. `--remote` is the real
 * `dialed-media` bucket, reached through a remote binding on the
 * operator's own `wrangler login`. No token is read or stored. The binding
 * is described in a config written to a temp directory, because
 * `wrangler.jsonc` keeps MEDIA local for dev (and is human-managed). The
 * bucket name is read from `wrangler.jsonc`, not restated.
 *
 * Run once, at the first deploy (docs/deployment.md §8). Re-running is
 * safe: a second pass finds nothing.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { getPlatformProxy, unstable_readConfig } from "wrangler";
import { z } from "zod";

import { purgeShopImages } from "./shop-images/purge";

const repoRoot = path.resolve(import.meta.dirname, "..");
const CONFIG = path.join(repoRoot, "wrangler.jsonc");

/**
 * The part of the resolved config this reads. Wrangler's own types for it
 * do not resolve here, and it is outside data either way, so it is parsed.
 */
const bucketSchema = z.object({
  binding: z.string(),
  bucket_name: z.string().optional(),
});
const configSchema = z.object({
  name: z.string(),
  compatibility_date: z.string(),
  r2_buckets: z.array(bucketSchema),
});

const args = new Set(process.argv.slice(2));
const isApply = args.has("--apply");
const isRemote = args.has("--remote");

/**
 * A config naming MEDIA alone, as a remote binding. Returns its path and a
 * cleanup.
 */
function remoteConfig(): { configPath: string; cleanup: () => void } {
  const config = configSchema.parse(unstable_readConfig({ config: CONFIG }));
  const media = config.r2_buckets.find((bucket) => bucket.binding === "MEDIA");
  if (media?.bucket_name === undefined) {
    throw new Error("wrangler.jsonc has no MEDIA bucket");
  }
  const dir = mkdtempSync(path.join(tmpdir(), "shop-images-"));
  const configPath = path.join(dir, "wrangler.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: config.name,
      compatibility_date: config.compatibility_date,
      r2_buckets: [
        { binding: "MEDIA", bucket_name: media.bucket_name, remote: true },
      ],
    }),
  );
  return {
    configPath,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function main(): Promise<void> {
  const target = isRemote ? remoteConfig() : undefined;
  const proxy = await getPlatformProxy<{ MEDIA: R2Bucket }>({
    configPath: target?.configPath ?? CONFIG,
    remoteBindings: isRemote,
  });
  try {
    const { keys, isDeleted } = await purgeShopImages(proxy.env.MEDIA, {
      apply: isApply,
    });
    const where = isRemote ? "the remote MEDIA bucket" : "local MEDIA";
    for (const key of keys) console.log(key);
    console.log(
      isDeleted
        ? `Deleted ${String(keys.length)} shop images from ${where}.`
        : `${String(keys.length)} shop images in ${where}. Dry run: nothing deleted. Pass --apply to delete them.`,
    );
  } finally {
    await proxy.dispose();
    target?.cleanup();
  }
}

await main();
