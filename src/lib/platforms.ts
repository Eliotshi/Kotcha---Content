import type { Enums, TablesInsert } from "@/lib/database.types";

export type Platform = Enums<"platform">;

export const PLATFORMS: Platform[] = ["instagram", "tiktok", "linkedin"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

type Item = Record<string, unknown>;

export type NormalizedPost = Omit<TablesInsert<"posts">, "account_id" | "raw"> & {
  followers?: number | null;
};

/** Construit l'entrée de l'actor Apify pour un compte suivi. */
export function buildActorInput(platform: Platform, handle: string, limit: number): Record<string, unknown> {
  switch (platform) {
    case "instagram":
      return {
        directUrls: [`https://www.instagram.com/${stripAt(handle)}/`],
        resultsType: "posts",
        resultsLimit: limit,
        addParentData: true,
      };
    case "tiktok":
      return {
        profiles: [stripAt(handle)],
        resultsPerPage: limit,
        profileScrapeSections: ["videos"],
        profileSorting: "latest",
        // Pas de téléchargement vidéo ici : on ne paie la vidéo que pour les nouveaux posts (buildMediaInput).
        shouldDownloadVideos: false,
        shouldDownloadCovers: true,
        shouldDownloadSubtitles: true,
        shouldDownloadSlideshowImages: false,
      };
    case "linkedin": {
      const url = linkedinUrl(handle);
      // Les actors LinkedIn n'utilisent pas tous les mêmes clés : on envoie les variantes courantes,
      // les clés inconnues sont ignorées par Apify. À resserrer une fois l'actor définitif choisi.
      return {
        targetUrls: [url],
        companyUrls: [url],
        urls: [url],
        maxPosts: limit,
        maxPostsPerTarget: limit,
        limit,
      };
    }
  }
}

/**
 * Collecte « média » ciblée : uniquement les posts à analyser (vidéos TikTok des nouveaux posts,
 * liens vidéo Instagram expirés). Renvoie null quand la plateforme n'en a pas besoin.
 */
export function buildMediaInput(platform: Platform, postUrls: string[]): Record<string, unknown> | null {
  if (!postUrls.length) return null;
  switch (platform) {
    case "tiktok":
      return {
        postURLs: postUrls,
        resultsPerPage: postUrls.length,
        shouldDownloadVideos: true,
        shouldDownloadCovers: true,
        shouldDownloadSubtitles: true,
        shouldDownloadSlideshowImages: false,
      };
    case "instagram":
      return { directUrls: postUrls, resultsType: "posts", resultsLimit: postUrls.length, addParentData: false };
    case "linkedin":
      return null;
  }
}

function stripAt(handle: string) {
  return handle.trim().replace(/^@/, "").replace(/\/$/, "").split("/").pop()!;
}

function linkedinUrl(handle: string) {
  if (handle.startsWith("http")) return handle;
  return `https://www.linkedin.com/company/${handle.replace(/^@/, "")}/`;
}

/** Met en forme le handle saisi dans l'interface. */
export function normalizeHandle(platform: Platform, input: string): string {
  const value = input.trim();
  if (platform === "linkedin") return linkedinUrl(value);
  return stripAt(value).toLowerCase();
}

export function profileUrl(platform: Platform, handle: string) {
  if (platform === "linkedin") return linkedinUrl(handle);
  if (platform === "tiktok") return `https://www.tiktok.com/@${stripAt(handle)}`;
  return `https://www.instagram.com/${stripAt(handle)}/`;
}

// ───────────── Normalisation des résultats Apify ─────────────

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Item)[key];
    return undefined;
  }, obj);
}

function first(obj: unknown, ...paths: string[]): unknown {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function date(v: unknown): string | null {
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

const SPONSORED_CAPTION = /(#(ad|pub|sponsoris[ée]e?|partenariat|partnership|collab)\b|partenariat r[ée]mun[ée]r[ée]|paid partnership|en collaboration avec)/i;

function flags(item: Item, caption: string | null, paths: { pinned: string[]; paid: string[]; collab: string[] }) {
  const truthy = (v: unknown) => v === true || (Array.isArray(v) && v.length > 0);
  return {
    is_pinned: paths.pinned.some((p) => truthy(get(item, p))),
    is_paid_partnership: paths.paid.some((p) => truthy(get(item, p))) || SPONSORED_CAPTION.test(caption ?? ""),
    is_collab: paths.collab.some((p) => truthy(get(item, p))),
    // Minimisation RGPD : on ne garde que la liste des clés (détection des changements de format), pas les valeurs.
    source_keys: Object.keys(item).sort(),
  };
}

function hashtagsFrom(text: string | null, list?: unknown): string[] {
  if (Array.isArray(list)) {
    return list
      .map((h) => (typeof h === "string" ? h : str(get(h, "name"))))
      .filter((h): h is string => Boolean(h))
      .slice(0, 30);
  }
  return Array.from(new Set((text ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? []))
    .map((h) => h.slice(1))
    .slice(0, 30);
}

export function normalizeItems(platform: Platform, items: Item[]): NormalizedPost[] {
  const flat = items.flatMap((item) => {
    // Le mode "details" d'Instagram renvoie un profil contenant latestPosts.
    if (platform === "instagram" && Array.isArray(item.latestPosts)) {
      return (item.latestPosts as Item[]).map((p) => ({ ...p, followersCount: item.followersCount }));
    }
    return [item];
  });
  return flat
    .filter((item) => !item.error && !item.errorDescription)
    .map((item) => normalizeItem(platform, item))
    .filter((p): p is NormalizedPost => p !== null);
}

function normalizeItem(platform: Platform, item: Item): NormalizedPost | null {
  switch (platform) {
    case "instagram":
      return normalizeInstagram(item);
    case "tiktok":
      return normalizeTiktok(item);
    case "linkedin":
      return normalizeLinkedin(item);
  }
}

function normalizeInstagram(item: Item): NormalizedPost | null {
  const externalId = str(first(item, "shortCode", "id"));
  if (!externalId) return null;
  const type = str(item.type) ?? "";
  const caption = str(item.caption);
  const music = [str(get(item, "musicInfo.artist_name")), str(get(item, "musicInfo.song_name"))]
    .filter(Boolean)
    .join(" — ");
  return {
    platform: "instagram",
    external_id: externalId,
    url: str(item.url) ?? `https://www.instagram.com/p/${externalId}/`,
    media_type: type === "Video" ? "video" : type === "Sidecar" ? "carousel" : "image",
    caption,
    hashtags: hashtagsFrom(caption, item.hashtags),
    music: music || null,
    published_at: date(item.timestamp),
    duration_sec: num(item.videoDuration),
    thumbnail_source_url: str(item.displayUrl),
    video_source_url: str(item.videoUrl),
    views: num(first(item, "videoPlayCount", "videoViewCount")),
    likes: num(item.likesCount) !== null && num(item.likesCount)! >= 0 ? num(item.likesCount) : null,
    comments: num(item.commentsCount),
    shares: null,
    saves: null,
    followers: num(first(item, "followersCount", "ownerFollowersCount")),
    ...flags(item, caption, {
      pinned: ["isPinned", "pinned"],
      paid: ["isSponsored", "paidPartnership", "isPaidPartnership"],
      collab: ["coauthorProducers"],
    }),
  };
}

function normalizeTiktok(item: Item): NormalizedPost | null {
  const externalId = str(first(item, "id"));
  if (!externalId) return null;
  const caption = str(item.text);
  const subtitles = get(item, "videoMeta.subtitleLinks");
  const subtitle = Array.isArray(subtitles)
    ? ((subtitles as Item[]).find((s) => String(s.language ?? "").startsWith("fr")) ?? (subtitles as Item[])[0])
    : undefined;
  const mediaUrls = Array.isArray(item.mediaUrls) ? (item.mediaUrls as unknown[]).map(str).filter(Boolean) : [];
  const music = [str(get(item, "musicMeta.musicName")), str(get(item, "musicMeta.musicAuthor"))]
    .filter(Boolean)
    .join(" — ");
  return {
    platform: "tiktok",
    external_id: externalId,
    url: str(item.webVideoUrl),
    media_type: item.isSlideshow ? "carousel" : "video",
    caption,
    hashtags: hashtagsFrom(caption, item.hashtags),
    music: music || null,
    published_at: date(first(item, "createTimeISO", "createTime")),
    duration_sec: num(get(item, "videoMeta.duration")),
    thumbnail_source_url: str(first(item, "videoMeta.coverUrl", "videoMeta.originalCoverUrl", "covers.0")),
    video_source_url: (mediaUrls[0] as string | undefined) ?? str(get(item, "videoMeta.downloadAddr")),
    subtitles_url: subtitle ? str(first(subtitle, "downloadLink", "tiktokLink")) : null,
    views: num(item.playCount),
    likes: num(item.diggCount),
    comments: num(item.commentCount),
    shares: num(item.shareCount),
    saves: num(item.collectCount),
    followers: num(get(item, "authorMeta.fans")),
    ...flags(item, caption, {
      pinned: ["isPinned", "pinned"],
      paid: ["isAd", "isSponsored", "isPaidPartnership"],
      collab: ["collaborators"],
    }),
  };
}

function normalizeLinkedin(item: Item): NormalizedPost | null {
  const externalId = str(first(item, "id", "urn", "postId", "entityId", "linkedinUrl", "url", "postUrl"));
  if (!externalId) return null;
  const caption = str(first(item, "content", "text", "commentary", "postText"));
  const video = first(item, "postVideo.videoUrl", "video.url", "videoUrl", "postVideo.url");
  const images = first(item, "postImages", "images", "imageUrls");
  const firstImage = Array.isArray(images) ? str(first(images[0], "url")) ?? str(images[0]) : null;
  const document = first(item, "document", "postDocument");
  return {
    platform: "linkedin",
    external_id: externalId,
    url: str(first(item, "linkedinUrl", "url", "postUrl", "shareUrl")),
    media_type: video ? "video" : document ? "document" : firstImage ? "image" : "text",
    caption,
    hashtags: hashtagsFrom(caption),
    music: null,
    published_at: date(first(item, "postedAt.date", "postedAt.timestamp", "postedAt", "publishedAt", "date", "time")),
    duration_sec: num(first(item, "postVideo.duration", "video.duration")),
    thumbnail_source_url: str(first(item, "postVideo.thumbnailUrl", "video.thumbnail")) ?? firstImage,
    video_source_url: str(video),
    views: num(first(item, "engagement.impressions", "views", "numViews")),
    likes: num(first(item, "engagement.likes", "engagement.reactions", "numLikes", "reactionsCount", "likes")),
    comments: num(first(item, "engagement.comments", "numComments", "commentsCount", "comments")),
    shares: num(first(item, "engagement.shares", "numShares", "repostsCount", "shares")),
    saves: null,
    followers: num(first(item, "author.followerCount", "author.followers", "company.followerCount")),
    ...flags(item, caption, { pinned: ["isPinned", "pinned"], paid: ["isSponsored", "sponsored"], collab: [] }),
  };
}

/**
 * Champs attendus dans la réponse de chaque actor (chaque groupe = alternatives équivalentes).
 * S'ils disparaissent de tous les résultats, l'actor a probablement changé de format.
 */
export const EXPECTED_KEYS: Record<Platform, string[][]> = {
  instagram: [["shortCode", "id"], ["timestamp"], ["likesCount"], ["commentsCount"], ["type"], ["displayUrl"]],
  tiktok: [["id"], ["createTimeISO", "createTime"], ["playCount"], ["diggCount"], ["commentCount"], ["webVideoUrl"]],
  linkedin: [
    ["id", "urn", "postId", "entityId", "linkedinUrl", "url", "postUrl"],
    ["content", "text", "commentary", "postText"],
    ["postedAt", "publishedAt", "date", "time"],
  ],
};
