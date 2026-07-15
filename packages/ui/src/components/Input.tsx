import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cx } from "../lib/cx";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the field as invalid; swaps the border to the accent color. */
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, style, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        "h-10 w-full rounded-[var(--radius-card)] px-3 text-sm",
        "bg-[var(--surface)] text-[var(--text)] placeholder:text-[var(--text-2)]",
        "border transition-colors duration-150",
        invalid ? "border-[var(--accent)]" : "border-[var(--line)]",
        "hover:border-[var(--line-hi)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:border-transparent",
        "disabled:opacity-50 disabled:pointer-events-none",
        className
      )}
      style={{ fontFamily: "var(--font-body)", ...style }}
      {...rest}
    />
  );
});
