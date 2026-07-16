import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Marketing site (T24) + public share pages (T21b, app/s/[slug]) both
  // live here now. Share pages read Supabase with the service role
  // server-side only (apps/web/lib/share.ts): no next.config changes
  // needed for that (no image remotePatterns: favicons are plain <img>
  // tags, not next/image, since sources are arbitrary per-link hosts; see
  // the comment in app/s/[slug]/page.tsx). The account area (billing,
  // Stripe) is still a later task (T23); keep this config minimal until then.
};

export default nextConfig;
