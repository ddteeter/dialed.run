import { Link } from "@tanstack/react-router";

/**
 * The five-tab shell footer (docs/product.md §Navigation). Every tab
 * points at "/" until its lane lands a real route — the typed Link is
 * mandatory (string hrefs are a lint error), and "/" is the only route
 * that exists in phase 0.
 */
const TABS = [
  // Placeholder target: lane 104 repoints this at /feed.
  { label: "Feed" },
  // Placeholder target: lane 101 repoints this at /closet.
  { label: "Closet" },
  // Placeholder target: lane 102 repoints this at /add.
  { label: "+ Add" },
  // Placeholder target: lane 105 repoints this at /call.
  { label: "Call" },
  // Placeholder target: lane 104 repoints this at /you.
  { label: "You" },
];

export function TabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 border-t border-night/15 bg-chalk pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="m-0 flex list-none justify-between px-5 py-4">
        {TABS.map((tab) => (
          <li key={tab.label}>
            <Link
              to="/"
              className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-night/50 no-underline"
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
