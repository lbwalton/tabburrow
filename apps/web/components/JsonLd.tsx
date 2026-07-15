/**
 * Renders a JSON-LD structured data block. `data` must be JSON-serializable.
 * "<" is escaped so a value containing "</script>" can never break out of
 * the script element; defensive default before user data ever flows through.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
