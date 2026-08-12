"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/discover", label: "Discover" },
  { href: "/queue", label: "Queue" },
  { href: "/applied", label: "Applied" },
  { href: "/outreach", label: "Outreach" },
  { href: "/interviews", label: "Interviews" },
  { href: "/analytics", label: "Analytics" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-sm">
      <div className="mx-auto flex h-11 max-w-[1400px] items-center gap-1 px-5">
        <Link
          href="/"
          className="mr-4 flex items-center gap-2 text-[13px] font-semibold tracking-tight"
        >
          <span className="grid h-5 w-5 place-items-center rounded bg-accent text-[10px] font-bold text-accent-fg">
            R
          </span>
          Pipeline
        </Link>

        <nav className="flex items-center gap-0.5">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  active
                    ? "bg-surface text-text"
                    : "text-muted hover:bg-surface hover:text-text"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/settings"
            className={`rounded-md px-2.5 py-1 transition-colors ${
              pathname.startsWith("/settings")
                ? "bg-surface text-text"
                : "text-muted hover:bg-surface hover:text-text"
            }`}
          >
            Settings
          </Link>
        </div>
      </div>
    </header>
  );
}
