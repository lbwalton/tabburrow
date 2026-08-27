# Changelog

Notable changes to the TabBurrow extension. Format based on Keep a Changelog; versions
follow Semantic Versioning.

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
