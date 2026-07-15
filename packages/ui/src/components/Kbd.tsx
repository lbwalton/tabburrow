import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

/** A single keyboard key/shortcut chip, e.g. <Kbd>⌘K</Kbd>. */
export function Kbd({ children, className, style, ...rest }: KbdProps) {
  return (
    <kbd
      className={cx(
        "inline-flex min-w-[1.5rem] items-center justify-center rounded-[6px] border px-1.5 py-0.5 text-xs",
        "border-[var(--line-hi)] bg-[var(--surface-hover)] text-[var(--text-2)]",
        className
      )}
      style={{ fontFamily: "var(--font-mono)", ...style }}
      {...rest}
    >
      {children}
    </kbd>
  );
}
