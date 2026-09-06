import { Link } from "@tanstack/react-router";

/**
 * The five-tab shell footer (docs/product.md §Navigation). Every tab
 * points at "/" until its lane lands a real route — the typed Link is
 * mandatory (string hrefs are a lint error). Lane 104 repoints Feed/You
 * here per its design doc; Closet/+Add/Call stay on "/" until their lanes
 * land.
 */
const TABS = [
  { label: "Feed", to: "/feed" },
  // Placeholder target: lane 101 repoints this at /closet.
  { label: "Closet", to: "/" },
  // Placeholder target: lane 102 repoints this at /add.
  { label: "+ Add", to: "/" },
  // Placeholder target: lane 105 repoints this at /call.
  { label: "Call", to: "/" },
  // You tab points at lane 104's own profile route until a `you/` lane exists.
  { label: "You", to: "/feed/me" },
] as const;

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
              to={tab.to}
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
