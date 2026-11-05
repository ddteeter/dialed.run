import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { Icon } from "../../../ui";

/**
 * The phone's way back to C (round 26 #9: "← Closet"), on garment detail,
 * F and Edit alike. The arrow is the pack's `back`, drawn rather than
 * typed, so it carries no text: the link's name is "Closet".
 *
 * Exact matching: by default Link marks a prefix match as the current
 * page, so every page it sits on ("/closet/…") announced "Closet, current
 * page" on a link that leaves it.
 */
export function BackToCloset(): JSX.Element {
  return (
    <Link
      to="/closet"
      activeOptions={{ exact: true }}
      className="target inline-flex items-center gap-2 self-start text-body text-quiet no-underline"
    >
      <Icon name="back" />
      Closet
    </Link>
  );
}
