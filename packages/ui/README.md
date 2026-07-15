# @tabburrow/ui

Deep Green design tokens (`tokens.css`) and React primitives for TabBurrow. Source-consumed, no build step.

## Consuming apps (Tailwind v4)

Components style themselves with Tailwind arbitrary-value classes (`bg-[var(--surface)]`), so any Tailwind v4 app importing this package MUST register its sources in the app's CSS entry, or those classes are never generated:

```css
@import "tailwindcss";
@source "../node_modules/@tabburrow/ui/src"; /* path relative to your CSS file */
@import "@tabburrow/ui/tokens.css";
```
