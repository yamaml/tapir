# Tapir Manual Test Session — 2026-06-04

Thorough human-tester pass via Playwright MCP. Every area exercised; all
errors/issues recorded here, then fixed.

## Environment
- Dev server: http://localhost:8081/tapir (version 0.1.7-beta.98)
- Browser: Playwright (Chromium)

## Issues found

(logged as discovered — ID, severity, area, description, repro, status)

| ID | Sev | Area | Issue | Status |
|----|-----|------|-------|--------|
| I1 | med | DatatypePicker + ShapeRefPicker | Svelte `derived_inert` warning on the 0→1 chip add. Root cause: `{#if selected.length===0}` swapped the `Popover.Trigger` element, destroying its effect (which owns an internal derived) mid-flush while the popover was open. Fix: single stable `Popover.Trigger` with reactive class/label (both pickers). **FIXED & verified — 0 warnings on repro.** | fixed |
| I2 | HIGH | Smart Table — all text cells | Tab-committing an inline text edit discarded the typed value and wrote the NEXT cell's value into the cell just left (data loss; e.g. Name→propertyId). Root cause: single shared `editValue`; Tab commits, then `startEdit(next)` overwrites `editValue`, then the old input's trailing `onblur` re-commits the stale value. Affected every text column (label/property/constraint/note/datatype) on Tab. Fix: `suppressBlurCommit` flag set during Tab navigation; guard all 5 `onblur` commit handlers. **FIXED & verified — Tab now persists the typed value.** Enter/Escape/click-away were already correct and untouched. | fixed |
| I3 | med | Tip wrapper + 6 callsites (History, namespace panel, undeclared-prefix banner, shape-item, new-project dialog, shape-ref-picker) | `derived_inert` warning fired across many overlays — same class as I1 but via the `Tip`/Tooltip wrapper. Two vectors: (a) `Tip` swapped its whole tooltip subtree on `{#if disabled || !text}`; (b) callsites put `<Tip>`-wrapped buttons inside action-driven `{#if}/{:else}` swaps that destroyed them mid-flush (e.g. History restore-confirm, namespace edit, banner declare). Fix: (a) `Tip` now always renders the tree and passes `disabled` to the primitive; (b) callsites keep the Tip buttons mounted and toggle with `hidden` (or use plain `title=` in the dialog); shape-ref-picker outer `{#if available>0}` removed. **FIXED & verified — 0 warnings across History/namespace/banner/picker flows.** | fixed |

## Test coverage log

(area-by-area notes)
