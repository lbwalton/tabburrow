import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  illustration?: ReactNode;
  /** Optional call-to-action (typically a <Button variant="primary">) rendered under the copy. */
  action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  illustration,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className
      )}
      {...rest}
    >
      {illustration ? <div className="mb-1 text-[var(--text-2)]">{illustration}</div> : null}
      <h3
        className="text-lg font-semibold text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h3>
      {description ? (
        <p
          className="max-w-sm text-sm text-[var(--text-2)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
