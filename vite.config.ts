import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    watch: {
      /**
       * `.wrangler/state` is tens of megabytes of local D1/R2/KV SQLite
       * inside the project root, and it is not source. Watching it is
       * wasted work on every write the app makes.
       *
       * **It is not a fix for D-57 and no version of this comment should
       * claim one.** Vite's watcher was never the mechanism, and neither
       * is the Cloudflare plugin's: the plugin's only `watcher.on("change")`
       * handler restarts on config paths, `.dev.vars` and assets config,
       * and on nothing else — so it does not react to its own persist path
       * either. See D-57 for what that leaves.
       *
       * Vite prepends its own ignores (`.git`, `node_modules`, the cache
       * dir and `test-results`), so this adds to them rather than
       * replacing them.
       */
      ignored: ["**/.wrangler/**"],
    },
  },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
