"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

type Item = { href: string; label: string; badge?: number };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/posts") : pathname.startsWith(href);
}

export function SideNav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cx(
            "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition",
            isActive(pathname, item.href) ? "bg-surface-2 font-medium text-text" : "text-text-2 hover:bg-surface-2 hover:text-text",
          )}
        >
          {item.label}
          {item.badge ? (
            <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">{item.badge}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cx(
            "relative flex flex-1 flex-col items-center py-3 text-xs",
            isActive(pathname, item.href) ? "font-semibold text-text" : "text-text-2",
          )}
        >
          {item.label}
          {item.badge ? <span className="absolute right-1/4 top-2 size-1.5 rounded-full bg-accent" /> : null}
        </Link>
      ))}
    </nav>
  );
}
