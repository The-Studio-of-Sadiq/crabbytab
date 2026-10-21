import type { MetadataRoute } from "next";
import { buildRobotsRules } from "@/lib/seo/robotsRules";
import { resolveSiteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  return buildRobotsRules(resolveSiteUrl());
}
