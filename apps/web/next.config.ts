import type { NextConfig } from "next";

/** Apex host, derived from SITE_URL so it can't drift from the canonical tags. */
const APEX_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tabburrow.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

// Content-Security-Policy. Tuned to exactly what the site loads:
//   - script/style 'unsafe-inline': Next's App Router hydration bootstrap and
//     Tailwind inject inline <script>/<style>; a nonce needs middleware and would
//     force every page dynamic, so we allow inline here (no external script hosts).
//   - img-src https:  share pages render per-link favicons from arbitrary hosts
//     as plain <img> (see app/s/[slug]/page.tsx).
//   - connect-src supabase.co / wss: the browser Supabase client (auth + account).
//   - Vercel Web Analytics is same-origin (/_vercel/insights/*), covered by 'self'.
//   - frame-ancestors 'none' is the CSP twin of X-Frame-Options: DENY (clickjacking).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

// Applied to every route (source: "/:path*"). These are the headers the audit
// flagged as missing; HSTS is strengthened here (Vercel's default omits
// includeSubDomains) so this config is the version-controlled source of truth.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
