import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/terms", "/privacy", "/dmca", "/report", "/contact"],
        // Watch and embed pages stay out of search results. There is no public
        // catalogue by design; letting crawlers build one anyway would undo
        // that decision and hand rights holders a searchable index.
        disallow: ["/watch/", "/embed/", "/dashboard", "/admin", "/upload"],
      },
    ],
  };
}
