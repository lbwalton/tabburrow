import { ImageResponse } from "next/og";
import { getSharedCollection, truncate } from "../../../lib/share";
import { SITE_NAME } from "../../../lib/site-config";

/**
 * Same 60s ISR window as the page itself (see page.tsx's `revalidate`
 * comment): this route is fetched independently by social-card crawlers,
 * so it needs its own cache directive rather than inheriting the page's.
 */
export const revalidate = 60;
export const alt = `${SITE_NAME} shared collection`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Literal brand hex values, same convention (and same sanctioned exception)
// as apps/web/assets/og-image.svg: this generator produces a static image
// asset per request, not rendered app UI, so it can't read the `--token`
// CSS custom properties the way a real page can. Kept in sync with
// packages/ui/src/tokens.css by hand.
const GROUND = "#16241E";
const WELL = "#0E1813";
const ACCENT = "#F97316";
const ACCENT_2 = "#D9A441";
const CREAM = "#EEE8D9";
const CREAM_DIM = "#B9C3BB";

interface OgImageProps {
  params: Promise<{ slug: string }>;
}

export default async function Image({ params }: OgImageProps) {
  const { slug } = await params;
  const shared = await getSharedCollection(slug);

  // A social-card crawler can request this route directly even for an
  // unknown/unshared slug (Next resolves it independently of the page's own
  // notFound()): render a generic, honest brand card instead of throwing,
  // since an error here would just surface as a broken image in the debugger.
  const heading = shared ? truncate(shared.collection.name, 60) : SITE_NAME;
  const subtitle = shared
    ? `${shared.links.length} link${shared.links.length === 1 ? "" : "s"} · shared with ${SITE_NAME}`
    : "Open-source tab and bookmark manager";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: GROUND,
          position: "relative",
        }}
      >
        {/* Faint oversized arch, pure atmosphere; mirrors assets/og-image.svg. */}
        <svg
          width="840"
          height="650"
          viewBox="0 0 840 650"
          style={{ position: "absolute", left: "-60px", top: "-20px" }}
        >
          <path
            d="M 0,650 L 0,430 A 420,420 0 0 1 840,430 L 840,650"
            fill="none"
            stroke={WELL}
            strokeWidth="60"
            opacity={0.6}
          />
        </svg>

        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <svg width="88" height="88" viewBox="0 0 128 128">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              fill={ACCENT}
              d="M24,112 L24,64 A40,40 0 0 1 104,64 L104,112 Z M40,112 L40,80 A24,24 0 0 1 88,80 L88,112 Z"
            />
            <rect x="12" y="116" width="104" height="10" rx="5" fill={ACCENT_2} />
          </svg>
          <span style={{ fontSize: 40, fontWeight: 700, color: CREAM }}>{SITE_NAME}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: "56px", maxWidth: "980px" }}>
          <span style={{ fontSize: 56, fontWeight: 700, color: CREAM, lineHeight: 1.15 }}>{heading}</span>
          <span style={{ fontSize: 28, color: CREAM_DIM, marginTop: "22px" }}>{subtitle}</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
