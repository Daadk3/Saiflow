import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private/auth surfaces and API stay out of search indexes
      disallow: ["/dashboard/", "/api/", "/login", "/signup", "/reset-password", "/forgot-password", "/success"],
    },
    sitemap: "https://www.saiflow.io/sitemap.xml",
  };
}
