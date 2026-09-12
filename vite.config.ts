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
       * `.wrangler/state` is 61 MB of local D1/R2/KV SQLite inside the
       * project root, and it is not source. Watching it is wasted work on
       * every write the app makes.
       *
       * **It does not fix D-57, and the first version of this comment
       * wrongly claimed it did.** A write still makes the dev server
       * reload the page a few seconds later — measured with this ignore in
       * place: one document load with no write, two with one. The
       * Cloudflare plugin owns the worker lifecycle and reacts to that
       * path itself, so silencing Vite's watcher does not reach it.
       * Moving the plugin's own `persistState` out of the project *would*,
       * but it desynchronises the dev server from
       * `wrangler d1 migrations apply --local`, which writes to wrangler's
       * default path regardless — so the app would read a database the
       * migration scripts never touch.
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
