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

## Session 2 (2026-06-05) — deeper pass

| ID | Sev | Area | Issue | Status |
|----|-----|------|-------|--------|
| O1 | doc | Diagram export / CLAUDE.md | PNG export is **shipped and working** (downloads a valid 4968×2428 PNG; PDF also works; ZIP package includes diagram.pdf). CLAUDE.md still says PNG/Graphviz-WASM is "deferred / not shipped". Not a bug — documentation drift. CLAUDE.md should be updated to reflect that PNG/PDF diagram export now works. | doc-update-needed |
| O2 | minor-a11y | Editor toolbar search button | The statement-search toggle (magnifier icon) had no `aria-label` (icon-only, no accessible name; it did have a Tip tooltip). **FIXED — added `aria-label="Search statements"` + `aria-expanded`.** | fixed |
| O3 | doc | Ctrl+K / CLAUDE.md wording | CLAUDE.md describes "Ctrl+K global search dialog" implying a vocab dialog; in fact Ctrl+K toggles the inline statement-property search (works correctly). Property/vocab lookup is via per-field autocomplete (works: typing `foaf:` lists FOAF terms, picking one commits). Wording could be clarified. | noted |

### Session 2 coverage (all ✓, 0 console errors)

- **Diagram (D1)** — maximise/minimise, zoom in/out/reset, settings panel
  (style Detail/Overview, 6 display toggles), exports SVG/PNG/PDF/DOT.
  PNG verified as a valid 4968×2428 raster. ✓
- **Search + autocomplete (D2)** — statement search (button + Ctrl+K) filters
  & highlights matches; property autocomplete lists vocab terms (`foaf:` →
  FOAF) and commits on pick. Added missing `aria-label` to search button. ✓
- **Description CRUD (D3)** — add description, MAIN name read-only lock
  (SimpleDSP), delete-with-confirm (I3 fix verified clean). ✓
- **Snapshot restore + autosave (D4)** — full round-trip verified at data +
  UI layers: save snapshot → edit label to "CHANGED" → restore → reverts to
  "Full Name". Autosave debounce persists edits. Restore-confirm clean (I3). ✓
- **Edge cases (D5)** — special chars in a comment (`Name, with "quotes" &
  comma; <tag> 日本語`) round-trip through DCTAP CSV export with correct
  RFC-4180 quoting; CSV parses with consistent columns. Re-verified I1/I2/I3
  fixes all hold (0 warnings on chip add, smart-table tab, tooltip overlays).

Bug fixed this session: **O2** (search-button aria-label).

Documentation drift found & corrected in CLAUDE.md this session:
- **O1** — PNG/PDF diagram export is shipped (via `@resvg/resvg-js` +
  `jspdf`/`svg2pdf.js`), not Graphviz WASM. CLAUDE.md updated.
- **O3** — Ctrl+K toggles statement search (not a vocab dialog). CLAUDE.md
  wording updated; per-field property autocomplete documented.
- **O4 (important)** — **PWA / offline IS shipped.** `@vite-pwa/sveltekit`
  1.1.0 is in deps, `SvelteKitPWA`+workbox configured in vite.config.ts, build
  emits sw.js + manifest.webmanifest. CLAUDE.md previously said PWA was
  deferred/not-in-deps and told the paper NOT to claim offline. Corrected in
  CLAUDE.md with an action to re-check the paper's offline/PWA claim. The
  DCMI-2026 paper guidance (workshop CLAUDE.md + paper notes) should be
  revisited — the app now installs and works offline.

## Test coverage log

All areas exercised as a human tester via Playwright MCP, with console
monitored throughout. Result: **0 console errors** across the whole
session; 3 real bugs found and fixed (I1–I3); all verified live.

- **Dashboard / lifecycle** — empty state, blank create (both flavors),
  example create (all 4), project cards, persistence across reload. ✓
- **Customized editor** — add/edit statement & description, all fields,
  ValueType dropdown, datatype picker, constraint editor, required-field
  validation, undeclared-prefix banner + one-click declare, JP/EN
  nomenclature toggle (no English/Japanese mixing). ✓
- **Smart Table / Raw Table** — mode switching lossless, color-coded value
  types, inline cell edit (found & fixed I2 Tab data-loss), assistance
  header. ✓
- **Import** — example load, URL import error (invalid URL → graceful
  message), malformed file (→ "no content, blank project" advisory, no
  crash). ✓
- **Export** — all generators valid on all 4 examples (36-check regression
  test added: SimpleDSP/DCTAP/SHACL/ShEx/OWL-DSP/JSON/Frictionless/diagram/
  HTML); UI download path for .tsv/.shacl.ttl/.zip; ZIP holds 13 artifacts. ✓
- **Validation panel** — "No issues" for a valid profile; undeclared-prefix
  detection via banner. ✓
- **Diagram / History / autosave** — diagram renders connected graph;
  labeled snapshots save + persist across reload; restore-confirm flow
  (found & fixed I3 derived_inert). ✓
- **Cross-cutting** — theme toggle (dark↔light), version in header/footer,
  derived_inert swept from chip pickers + Tip across all overlays (I1, I3).
  Console clean. ✓

Final state: type-check 0 errors, 582 tests pass, production build OK,
version 0.1.7-beta.100.
