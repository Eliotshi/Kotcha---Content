"use client";

import { useActionState, type ReactNode } from "react";
import { createScript, type ActionResult } from "@/app/(app)/actions";

export function ScriptForm({ children, className }: { children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(createScript, null);
  return (
    <form action={formAction} className={className}>
      {state && !state.ok && (
        <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical lg:col-span-2">
          {state.error}
        </p>
      )}
      {children}
    </form>
  );
}
