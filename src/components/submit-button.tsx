"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({ children, pendingLabel, className }: { children: ReactNode; pendingLabel: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
