import "server-only";
import { timingSafeEqual } from "node:crypto";

export function safeEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}
