import type { ReactNode } from "react";

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export interface TopNavTab {
  label: string;
  href: string;
  active: boolean;
  /** Optional click interceptor so consumers can do client-side routing. */
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

export interface TopNavSearchTrigger {
  placeholder: string;
  shortcut?: string;
  onClick?: () => void;
}

interface BaseProps {
  /** Brand link target. */
  logoHref: string;
  /** Optional click interceptor for client-side routing on the logo. */
  onLogoClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Right-aligned controls (theme menu, auth, etc.). */
  actions: ReactNode;
}

export interface TopNavFullProps extends BaseProps {
  mode: "full";
  tabs: TopNavTab[];
  search?: TopNavSearchTrigger;
}

export interface TopNavCompactProps extends BaseProps {
  mode: "compact";
  /** Single-line breadcrumb shown next to the logo. */
  crumb: string;
}

export type TopNavShellProps = TopNavFullProps | TopNavCompactProps;

/**
 * Shared top navigation shell used by both the marketing site (Next.js) and
 * the authoring app (Vite). Purely presentational — consumers pass in tabs,
 * search trigger, and action controls. Uses plain `<a>` so it renders in any
 * router context. Two layouts:
 *
 *  - `mode="full"`: brand + tabs on the left, search trigger in the middle,
 *    actions on the right. Used on landing surfaces (library, my-books).
 *  - `mode="compact"`: brand + crumb on the left, actions on the right. Used
 *    on book detail / page surfaces where the chrome stays out of the way.
 */
export function TopNavShell(props: TopNavShellProps) {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto h-14 max-w-7xl px-8">
        {props.mode === "full" ? (
          <FullLayout {...props} />
        ) : (
          <CompactLayout {...props} />
        )}
      </div>
    </nav>
  );
}

function FullLayout({
  logoHref,
  onLogoClick,
  tabs,
  search,
  actions,
}: TopNavFullProps) {
  return (
    <div className="flex h-full items-center justify-between gap-6">
      <div className="flex items-center gap-5">
        <a
          href={logoHref}
          onClick={onLogoClick}
          className="pv-display text-2xl font-normal italic tracking-tight text-foreground"
        >
          Pensive
        </a>
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <TabLink key={tab.href + tab.label} {...tab} />
          ))}
        </div>
      </div>

      {search ? (
        <button
          type="button"
          onClick={search.onClick}
          className="hidden flex-1 items-center gap-3 rounded-[10px] border border-border bg-[hsl(var(--pv-surface-2))] px-3.5 py-2 text-left text-[hsl(var(--pv-text-muted))] md:flex md:max-w-[460px]"
        >
          <SearchIcon className="h-4 w-4 opacity-60" />
          <span className="pv-serif flex-1 truncate text-[15px] italic">
            {search.placeholder}
          </span>
          {search.shortcut ? (
            <kbd className="pv-mono rounded border border-border px-1.5 py-0.5 text-[10px] text-[hsl(var(--pv-text-faint))]">
              {search.shortcut}
            </kbd>
          ) : null}
        </button>
      ) : (
        <div className="hidden flex-1 md:block" />
      )}

      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}

function CompactLayout({
  logoHref,
  onLogoClick,
  crumb,
  actions,
}: TopNavCompactProps) {
  return (
    <div className="flex h-full items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-5">
        <a
          href={logoHref}
          onClick={onLogoClick}
          className="pv-display text-2xl font-normal italic tracking-tight text-foreground"
        >
          Pensive
        </a>
        <span
          className="pv-mono truncate text-[11px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]"
          title={crumb.replace(/\s{2,}/g, " ")}
        >
          {crumb}
        </span>
      </div>

      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}

function TabLink({ label, href, active, onClick }: TopNavTab) {
  return (
    <a
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`pv-serif relative px-3.5 py-2 text-[16px] transition-colors ${
        active
          ? "italic text-foreground"
          : "text-[hsl(var(--pv-text-muted))] hover:text-foreground"
      }`}
    >
      {label}
      {active ? (
        <span className="absolute inset-x-3.5 bottom-1 h-px bg-foreground" />
      ) : null}
    </a>
  );
}
