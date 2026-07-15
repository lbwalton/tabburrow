import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export type LinkButtonVariant = "primary" | "ghost";
export type LinkButtonSize = "sm" | "md";

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: LinkButtonVariant;
  size?: LinkButtonSize;
  children: ReactNode;
}

// Mirrors @tabburrow/ui's <Button> visual language for CTAs that must be
// real <a> elements (external links, navigation) rather than <button>s;
// Button only renders a native button, and nesting an <a> inside one would
// be invalid HTML. Kept local to apps/web rather than changing the shared
// primitive's API.
const base = cx(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap",
  "font-medium transition-colors duration-150",
  "rounded-[var(--radius-card)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-ground)]"
);

const sizeClasses: Record<LinkButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-[0.9375rem]",
};

const variantClasses: Record<LinkButtonVariant, string> = {
  primary: "bg-[var(--accent)] text-[var(--btn-fg)] hover:brightness-110 active:brightness-95",
  ghost:
    "bg-transparent text-[var(--text)] border border-[var(--line)] hover:bg-[var(--surface-hover)] hover:border-[var(--line-hi)]",
};

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  style,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a
      className={cx(base, sizeClasses[size], variantClasses[variant], className)}
      style={{ fontFamily: "var(--font-body)", ...style }}
      {...rest}
    >
      {children}
    </a>
  );
}
