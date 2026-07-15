/**
 * Small inline marks used in chrome (nav, footer, buttons). The burrow arch
 * reuses the exact silhouette from apps/extension/assets/icon.svg, but as
 * inline SVG it can (and must) read the brand tokens instead of hardcoding
 * hex. Only standalone assets that can't see CSS vars (app/icon.svg,
 * assets/og-image.svg) keep literal brand hexes.
 */
export function BurrowMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="var(--accent)"
        d="M24,112 L24,64 A40,40 0 0 1 104,64 L104,112 Z M40,112 L40,80 A24,24 0 0 1 88,80 L88,112 Z"
      />
      <rect x="12" y="116" width="104" height="10" rx="5" fill="var(--accent-2)" />
    </svg>
  );
}

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.76.12 3.05.74.8 1.19 1.83 1.19 3.09 0 4.43-2.7 5.4-5.27 5.69.42.36.78 1.07.78 2.16v3.2c0 .32.21.68.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
