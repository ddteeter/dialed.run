import { Link } from "@tanstack/react-router";

/**
 * The five-tab shell footer (docs/product.md §Navigation). Each tab points
 * at "/" until its lane lands a real route — the typed Link is mandatory
 * (string hrefs are a lint error). Lane 101 repoints Closet at /closet;
 * the rest stay placeholders until their lanes land.
 */
const TAB_CLASS =
  "font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-night/50 no-underline";

export function TabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 border-t border-night/15 bg-chalk pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="m-0 flex list-none justify-between px-5 py-4">
        <li>
          {/* Placeholder target: lane 104 repoints this at /feed. */}
          <Link to="/" className={TAB_CLASS}>
            Feed
          </Link>
        </li>
        <li>
          <Link to="/closet" className={TAB_CLASS}>
            Closet
          </Link>
        </li>
        <li>
          {/* Placeholder target: lane 102 repoints this at /add. */}
          <Link to="/" className={TAB_CLASS}>
            + Add
          </Link>
        </li>
        <li>
          {/* Placeholder target: lane 105 repoints this at /call. */}
          <Link to="/" className={TAB_CLASS}>
            Call
          </Link>
        </li>
        <li>
          {/* Placeholder target: lane 104 repoints this at /you. */}
          <Link to="/" className={TAB_CLASS}>
            You
          </Link>
        </li>
      </ul>
    </nav>
  );
}
