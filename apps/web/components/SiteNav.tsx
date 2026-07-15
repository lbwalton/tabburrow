"use client";

import { useState } from "react";
import Link from "next/link";
import { LinkButton } from "./LinkButton";
import { BurrowMark, GitHubMark } from "./icons";
import { CHROME_STORE_URL, GITHUB_URL, SITE_NAME, marketingNavLinks } from "../lib/site-config";

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg-ground)]/95 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4"
      >
        <Link
          href="/"
          className="flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <BurrowMark className="h-7 w-7" />
          <span
            className="text-lg font-bold text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {SITE_NAME}
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-6 md:flex">
          {marketingNavLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-sm text-sm font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {link.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <GitHubMark className="h-4 w-4" />
            GitHub
          </a>
        </div>

        <div className="hidden md:block">
          <LinkButton href={CHROME_STORE_URL} size="sm" className="h-9">
            Add to Chrome
          </LinkButton>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-card)] border border-[var(--line)] text-[var(--text)] md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {open ? (
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </nav>

      {open ? (
        <div
          id="mobile-nav"
          className="flex flex-col gap-1 border-t border-[var(--line)] px-6 py-4 md:hidden"
        >
          {marketingNavLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-sm py-2 text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-sm py-2 text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <GitHubMark className="h-4 w-4" />
            GitHub
          </a>
          <div className="mt-2">
            <LinkButton href={CHROME_STORE_URL} size="sm" className="w-full">
              Add to Chrome
            </LinkButton>
          </div>
        </div>
      ) : null}
    </header>
  );
}
