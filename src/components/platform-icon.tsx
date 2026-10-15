import type { Platform } from "@/lib/platforms";
import { PLATFORM_LABEL } from "@/lib/platforms";

export function PlatformTag({ platform }: { platform: Platform | null }) {
  if (!platform) return null;
  const glyph = { instagram: "IG", tiktok: "TT", linkedin: "in" }[platform];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-text-2"
      title={PLATFORM_LABEL[platform]}
    >
      <span className="font-semibold">{glyph}</span>
      <span className="hidden sm:inline">{PLATFORM_LABEL[platform]}</span>
    </span>
  );
}
