import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const base = cx(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap",
  "font-medium transition-colors duration-150",
  "rounded-[var(--radius-card)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-ground)]",
  "disabled:opacity-50 disabled:pointer-events-none"
);

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-[0.9375rem]",
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-[var(--accent)] text-[var(--btn-fg)] hover:brightness-110 active:brightness-95",
  // A translucent cream lift (not a solid --surface fill) so a ghost button
  // reads as raised on BOTH the dark ground AND inside a --surface dialog,
  // where a solid --surface fill would blend into the dialog.
  ghost: "bg-[color-mix(in_srgb,var(--text)_6%,transparent)] text-[var(--text)] border border-[var(--line)] hover:bg-[var(--surface-hover)] hover:border-[var(--line-hi)]",
  danger: "bg-transparent text-[var(--accent)] border border-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--btn-fg)]",
};

/**
 * Primary interactive control. `style` fontFamily is set inline (not via an
 * arbitrary Tailwind class) because it references a CSS custom property with
 * a comma-separated fallback stack, which Tailwind's bracket syntax can't
 * express cleanly.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, style, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cx(base, sizeClasses[size], variantClasses[variant], className)}
      style={{ fontFamily: "var(--font-body)", ...style }}
      {...rest}
    >
      {children}
    </button>
  );
});
