import type { NextConfig } from "next";

/** Apex host, derived from SITE_URL so it can't drift from the canonical tags. */
const APEX_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tabburrow.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const nextConfig: NextConfig = {
  // `www.tabburrow.com` used to serve a 200 alongside the apex, so both hosts
  // returned the same pages. The canonical tags already pointed at the apex
  // (metadataBase is SITE_URL), so this was mitigated rather than broken, but
  // a 301 is the actual fix. Kept here rather than in Vercel's Domains panel
  // so it's version-controlled and survives a project re-link.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: `www.${APEX_HOST}` }],
        destination: `https://${APEX_HOST}/:path*`,
        permanent: true,
      },
    ];
  },
  // Marketing site (T24) + public share pages (T21b, app/s/[slug]) both
  // live here now. Share pages read Supabase with the service role
  // server-side only (apps/web/lib/share.ts): no next.config changes
  // needed for that (no image remotePatterns: favicons are plain <img>
  // tags, not next/image, since sources are arbitrary per-link hosts; see
  // the comment in app/s/[slug]/page.tsx). The account area (billing,
  // Stripe) is still a later task (T23); keep this config minimal until then.
};

export default nextConfig;
