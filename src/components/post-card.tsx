import Link from "next/link";
import type { Views } from "@/lib/database.types";
import { fmtDate, fmtDuration, fmtNumber, storageUrl } from "@/lib/format";
import { FORMATS, label, PROCESSING_LABEL } from "@/lib/labels";
import { Badge, Card, CompetitorDot, OutlierBadge } from "@/components/ui";
import { PlatformTag } from "@/components/platform-icon";

export type FeedPost = Views<"post_feed">;

export function Thumbnail({ post, className }: { post: Pick<FeedPost, "thumbnail_path" | "thumbnail_source_url" | "caption">; className?: string }) {
  const src = storageUrl(post.thumbnail_path) ?? post.thumbnail_source_url;
  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-surface-2 p-4 text-center text-xs text-muted ${className ?? ""}`}>
        {post.caption ? post.caption.slice(0, 120) : "Pas d'aperçu"}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className={`bg-surface-2 object-cover ${className ?? ""}`} />;
}

export function PostCard({ post }: { post: FeedPost }) {
  const duration = fmtDuration(post.duration_sec);
  return (
    <Link href={`/posts/${post.id}`} className="group block">
      <Card className="flex h-full overflow-hidden transition group-hover:border-text-2/40">
        <div className="relative w-28 shrink-0 sm:w-32">
          <Thumbnail post={post} className="absolute inset-0 h-full w-full" />
          {duration && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 text-[11px] font-medium text-white">{duration}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2">
            <span className="inline-flex items-center gap-1.5 font-medium text-text">
              <CompetitorDot color={post.competitor_color} />
              {post.competitor_name}
            </span>
            <PlatformTag platform={post.platform} />
            <span>{fmtDate(post.published_at)}</span>
          </div>
          <p className="line-clamp-2 text-sm text-text">
            {post.hook ? `« ${post.hook} »` : (post.caption ?? "Sans légende")}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-2">
            {post.views !== null && (
              <span className="tabular">
                <span className="font-semibold text-text">{fmtNumber(post.views)}</span> vues
              </span>
            )}
            <span className="tabular">
              <span className="font-semibold text-text">{fmtNumber(post.likes)}</span> likes
            </span>
            <span className="tabular">
              <span className="font-semibold text-text">{fmtNumber(post.comments)}</span> comm.
            </span>
            <OutlierBadge score={post.outlier_score} />
            {post.format && <Badge>{label(FORMATS, post.format)}</Badge>}
            {post.processing_status && post.processing_status !== "done" && (
              <Badge tone={post.processing_status === "failed" ? "critical" : "warning"}>
                {label(PROCESSING_LABEL, post.processing_status)}
              </Badge>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
