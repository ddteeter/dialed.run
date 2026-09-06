import { Link } from "@tanstack/react-router";

const TAB_CLASS =
  "font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-night/50 no-underline";

/**
 * The five-tab shell footer (docs/product.md §Navigation). Each tab is a
 * separate typed <Link> (rather than a generic map over a shared `to`)
 * because TanStack's route paths are checked as literals against the
 * generated route tree — widening them into a shared `string` field would
 * defeat that check. Tabs whose lane hasn't landed yet still point at "/".
 */
export function TabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 border-t border-night/15 bg-chalk pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="m-0 flex list-none justify-between px-5 py-4">
        {/* Placeholder target: lane 104 repoints this at /feed. */}
        <li>
          <Link to="/" className={TAB_CLASS}>
            Feed
          </Link>
        </li>
        {/* Placeholder target: lane 101 repoints this at /closet. */}
        <li>
          <Link to="/" className={TAB_CLASS}>
            Closet
          </Link>
        </li>
        <li>
          <Link to="/runs/new" className={TAB_CLASS}>
            + Add
          </Link>
        </li>
        {/* Placeholder target: lane 105 repoints this at /call. */}
        <li>
          <Link to="/" className={TAB_CLASS}>
            Call
          </Link>
        </li>
        {/* Placeholder target: lane 104 repoints this at /you. */}
        <li>
          <Link to="/" className={TAB_CLASS}>
            You
          </Link>
        </li>
      </ul>
    </nav>
  );
}
