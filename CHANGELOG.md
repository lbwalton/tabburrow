# Changelog

Notable changes to the TabBurrow extension. Format based on Keep a Changelog; versions
follow Semantic Versioning.

## [1.2.0] - 2026-09-08

### Added
- Cross-folder search, select, and open-all: search a topic (say "meta business"), tick the
  results you want across every folder, and open them together in one click. With nothing
  ticked the button opens every match. Works in both the popup and the dashboard's Cmd/Ctrl+K
  search. Opening more than 15 tabs asks for confirmation first.
- Popup search results now show which folder each link belongs to. With a folder per client
  and the same link title in each, that label is what tells the results apart.
- Search returns more results (20 → 100, and 8 → 50 in the popup), so "open all" can actually
  reach every folder rather than stopping at a cap.

### Fixed
- Links added by typing a bare domain now open the real site. Typing `nike.com` used to store
  it without a scheme, and clicking it opened `chrome-extension://…/nike.com` instead of Nike.
  Links already saved that way are repaired when opened, so no re-adding is needed.

### Security
- Link addresses are now checked when they're saved. Only `http`, `https`, and `file` links can
  be stored, so a `javascript:` or `data:` address can't be saved as a link — which also keeps
  it out of a collection you later share publicly. Importing a TabBurrow export skips any such
  links and tells you how many it skipped.

## [1.1.0] - 2026-08-27

### Added
- Visible multi-select on the dashboard: link cards reveal a selection checkbox on hover
  or focus that persists once anything is selected, plus a "shift-click for a range" hint
  in the bulk bar (the same discoverable pattern the popup already had).
- Finder-style multi-range selection: shift-click ranges now accumulate, so you can select
  one range, skip down, select another, and keep both. Re-ranging from the same anchor
  still grows or shrinks only the current range. Works on both the dashboard and the popup.

### Changed
- Clearer "clear selection" control: the × on the selection bars is now a larger button
  with a hover lift and a tooltip, so it reads as an action.

### Fixed
- Edit-link popover is no longer clipped in the popup: opening the editor on a lower link
  row flips it above the row instead of running off the bottom edge of the popup window.

## [1.0.0]

- Initial public release.
