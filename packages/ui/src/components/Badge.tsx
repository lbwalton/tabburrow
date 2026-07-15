import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export type BadgeVariant = "accent" | "accent-2" | "muted";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  accent: "bg-[var(--accent)] text-[var(--btn-fg)]",
  "accent-2": "bg-[var(--accent-2)] text-[var(--ink)]",
  muted: "bg-[var(--surface-hover)] text-[var(--text-2)] border border-[var(--line)]",
};

/** Small pill for counts, collection accents, and status labels. */
export function Badge({ variant = "muted", className, style, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
        variantClasses[variant],
        className
      )}
      style={{ fontFamily: "var(--font-mono)", ...style }}
      {...rest}
    >
      {children}
    </span>
  );
}
