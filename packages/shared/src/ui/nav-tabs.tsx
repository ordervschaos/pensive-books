export interface NavTab {
  label: string;
  href: string;
  active: boolean;
}

export interface NavTabsProps {
  tabs: NavTab[];
}

const tabClass = "relative px-4 py-2 text-sm font-medium transition-colors";
const activeClass =
  "text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-foreground";
const inactiveClass = "text-muted-foreground hover:text-foreground";

/**
 * Shared tabs strip used at the top of /books (web app) and /library
 * (marketing app). Purely presentational — consumers decide which tab is
 * active and where each one links. Uses plain `<a>` so it renders in both
 * Vite/react-router and Next.js App Router contexts and works across origins.
 */
export function NavTabs({ tabs }: NavTabsProps) {
  return (
    <div className="border-b bg-background">
      <div className="container mx-auto max-w-7xl px-4">
        <div className="flex space-x-4">
          {tabs.map((tab) => (
            <a
              key={tab.href}
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={`${tabClass} ${tab.active ? activeClass : inactiveClass}`}
            >
              {tab.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
