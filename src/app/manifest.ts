import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kotcha Content",
    short_name: "Kotcha",
    description: "Veille concurrentielle et scripts vidéo",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#f7f7f5",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
