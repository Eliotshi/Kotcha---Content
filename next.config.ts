import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static ships a native binary: keep it out of the bundle and trace it into the functions that extract frames.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/jobs/process": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/cron/process": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/webhooks/apify": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/posts/[id]": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
