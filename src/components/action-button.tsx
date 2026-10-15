"use client";

import { useState, useTransition, type ReactNode } from "react";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Bouton qui appelle une Server Action et affiche son résultat (limite atteinte, budget épuisé…). */
export function ActionButton({
  action,
  children,
  pendingLabel,
  className,
  disabled,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  pendingLabel: string;
  className: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  return (
    <span className="inline-flex flex-col items-stretch gap-1">
      <button
        type="button"
        className={className}
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setResult(await action());
          })
        }
      >
        {pending ? pendingLabel : children}
      </button>
      {result && (
        <span role="status" className={`text-xs ${result.ok ? "text-good" : "text-critical"}`}>
          {result.ok ? result.message : result.error}
        </span>
      )}
    </span>
  );
}
