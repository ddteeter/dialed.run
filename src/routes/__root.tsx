import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";

import { signedInQuery } from "../modules/auth/functions";
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
      /*
       * **The three latin faces, self-hosted and preloaded.**
       *
       * A Google Fonts `<link>` used to sit here, and before that an
       * `@import` in `src/styles.css`. Both flashed on every cold load:
       * the glyphs were three round trips and two origins deep — the
       * document, then `fonts.googleapis.com` for a stylesheet, then
       * `fonts.gstatic.com` for the files it names — so however early the
       * request went out, the preconnects beside it warmed a connection
       * that was still not the last hop. The files live in `public/fonts`
       * now and `src/ui/fonts.css` declares them.
       *
       * A `@font-face` is only a rule: the file behind it is requested
       * when something is laid out in it, which is after the app CSS has
       * been fetched *and* parsed. These go out with the document instead,
       * which is the shortest the chain gets.
       *
       * `display=swap` is deliberate and stays. The alternative,
       * `optional`, drops the brand face entirely on a slow connection,
       * and a run-wardrobe app whose wordmark silently falls back to
       * Helvetica is worse than one that reflows — swap is only visible
       * while the file is in flight, and a preloaded same-origin file is
       * in flight for about as long as the document was.
       *
       * All three, because all three paint above the fold on essentially
       * every screen: Archivo Black for the uppercase headings, Archivo
       * for body copy, Plex Mono for every measured value in bracket
       * notation. `latin-ext` is deliberately not preloaded — a preloaded
       * font a page never uses is a console warning and wasted bandwidth,
       * and it exists only for the occasional accented product name, which
       * the stylesheet discovers when a glyph needs it.
       *
       * `crossOrigin` is required even same-origin: a font preload without
       * it is fetched in a different mode than the one the font loader
       * later asks for, so the browser downloads the file twice and the
       * preload buys nothing.
       *
       * Spelled out three times rather than mapped, because a route file
       * may not `.map(` — `server-functions-are-glue` forbids it, since
       * nothing can import a route to assert on what a loop there built.
       */
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "/fonts/archivo-variable-latin.woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "/fonts/archivo-black-latin.woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "/fonts/ibm-plex-mono-400-latin.woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  // Whether anyone is signed in, read once and kept until a sign-in or a
  // sign-out invalidates it: the system states frame themselves by it
  // (round 22, X1/X2) and nothing else here needs it fresh per navigation.
  loader: () => signedInQuery(),
  staleTime: Infinity,
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
