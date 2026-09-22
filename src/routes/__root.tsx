import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";

/**
 * The three families `design/tokens.js` names — Archivo Black says it,
 * Archivo explains it, IBM Plex Mono measured it — and the four weights
 * `styles.css` maps onto the theme.
 *
 * `display=swap` is deliberate and stays: the alternative, `optional`,
 * drops the brand face entirely on a slow connection, and a run-wardrobe
 * app whose wordmark silently falls back to Helvetica is worse than one
 * that reflows. What removes the jump is getting this request out early,
 * which is what having it here does.
 */
const FONTS =
  "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";
import { Devtools } from "../ui/Devtools";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "[dialed.run]",
      },
    ],
    links: [
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      // **Before the app stylesheet, and in the head rather than in it.**
      // This was an `@import` at the top of `src/styles.css`, where the
      // preload scanner cannot see it: the request could not start until
      // that file had been fetched and parsed, so the font CSS, the font
      // files and the app CSS went out strictly in series and the two
      // preconnects above warmed a connection nothing was using yet. The
      // visible cost was a reflow a second into every cold load — text
      // painting in `ui-sans-serif`, then jumping as Archivo arrived.
      //
      // Declared first so the `@font-face` rules are known as early as
      // possible; there is no cascade interaction to order against,
      // because this stylesheet declares faces and nothing else.
      {
        rel: "stylesheet",
        href: FONTS,
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-ground font-sans text-ink antialiased">
        {children}
        <Devtools />
        <Scripts />
      </body>
    </html>
  );
}
