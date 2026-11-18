import type { JSX } from "react";

import { linkDomainOf } from "../lib/domain";

import { Mono } from "./Mono";

/**
 * A product link a stranger typed (packet §3, link hygiene).
 *
 * **Two rel values, and each earns its place.** `ugc` says a runner
 * wrote this, not us. `nofollow` stops a closet being an SEO donation to
 * whoever pastes the most links.
 *
 * **The same tab** (R59·322): nothing marks a new tab, so none opens, and
 * Back returns the runner. With no new tab there is no `window.opener`
 * to withhold, so `noopener` went with `target`.
 *
 * **The bare domain is shown, always.** A link whose text a stranger
 * chose tells a reader nothing about where it goes, and "check the status
 * bar" is not a defence on a phone. The host is the one part of a URL
 * that says who is on the other end, so it is rendered beside the text
 * rather than hidden behind it.
 *
 * Mono for the domain, because that is what mono is for here: a value the
 * system read out of the data rather than a word someone wrote.
 *
 * `https` only is already enforced at save (lane 101). A stored value
 * that is not parseable renders as plain text with no anchor at all —
 * better than an anchor to something we could not read.
 */
export function ProductLink({
  url,
  label,
}: Readonly<{
  /**
   * `null` for a garment with no link, which is most of them.
   *
   * Taken here rather than guarded at the call site: there it was a
   * ternary whose two branches no test could tell apart, because a
   * component that renders nothing and a component that is not rendered
   * look identical from outside. Asked of the component directly, they
   * do not.
   *
   * `undefined` for a named piece that has no link (D's kit list, round
   * 43 #96): the label alone, as a link we cannot read gets. A call site
   * that guarded for it drew the same `<span>` this does, so its ternary
   * was two branches no test could tell apart; `domainOf` already
   * answers an absent URL.
   */
  url: string | null | undefined;
  /**
  What the link says. A product name, typically — and it is UGC.
  */
  label: string;
}>): JSX.Element | undefined {
  if (url === null) return undefined;
  const domain = linkDomainOf(url);

  if (domain === undefined) {
    // No anchor. A URL we cannot parse is one we cannot vouch for, and an
    // <a href> to it would be us passing it on anyway.
    return <span>{label}</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <a
        data-target="inline"
        href={url}
        rel="ugc nofollow"
        className="underline underline-offset-4"
      >
        {label}
      </a>
      <Mono step="md" className="text-quiet">
        {domain}
      </Mono>
    </span>
  );
}
