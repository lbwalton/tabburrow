import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export type CardVariant = "surface" | "paper";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** Apply the "burrow arch" motif (rounded top, near-flat bottom corners). Default true. */
  arch?: boolean;
  children?: ReactNode;
}

const variantClasses: Record<CardVariant, string> = {
  surface: "bg-[var(--surface)] text-[var(--text)] border-[var(--line)]",
  paper: "bg-[var(--paper)] text-[var(--ink)] border-[var(--paper-line)]",
};

export function Card({ variant = "surface", arch = true, className, style, children, ...rest }: CardProps) {
  return (
    <div
      className={cx("border p-4", variantClasses[variant], className)}
      style={{
        borderRadius: arch ? "var(--radius-arch)" : "var(--radius-card)",
        fontFamily: "var(--font-body)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
