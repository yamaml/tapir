# Load Example Profiles — Design

**Date:** 2026-06-04
**Project:** Tapir (SvelteKit application profile editor)
**Status:** Approved design, pending implementation

## Goal

Let a user load a ready-made example profile for both supported flavors
(SimpleDSP and DCTAP) so they can explore the editor without authoring a
profile from scratch. Examples must work offline and load through Tapir's
existing import path so they behave identically to a user-imported file.

## Scope

In scope:

- Two bundled examples for the first version:
  - **SimpleDSP** — Big Bang Theory character profile
    (`tbbt-simpledsp.tsv`, copied from `yama-cli/examples/tbbt/`).
  - **DCTAP** — SRAP April model (`srap-april-model.csv`, the SCOSS/SRAP
    Scholarly Resource Application Profile; already vendored as a Tapir
    test fixture, so it is known to parse).
- An extensible registry so adding a third example later is a data-only
  change (one array entry + one `?raw` import), no UI changes.
- Two entry points: a new **Example** tab in the New Project dialog, and
  two quick buttons on the dashboard empty state.

Out of scope (deferred, not cancelled):

- A standalone `/examples` gallery route.
- More than two examples (the registry supports it; we ship two).
- Editing or generating examples in-app.

## Decisions (resolved during brainstorming)

| Topic | Decision | Rationale |
|---|---|---|
| Placement | Both: dialog tab + dashboard quick buttons | Maximum discoverability; both feed the same loader. |
| Example count | Build an extensible registry; ship two | "Room for more now" without authoring more data. |
| Data source | Bundle locally (no GitHub fetch) | Offline-safe, instant, no network dependency, fits privacy-first design. |
| Bundling method | Vite `?raw` build-time string imports | Avoids `${base}` path juggling and runtime `fetch`; guarantees offline availability. |
| Namespace handling for SRAP | Load exactly as-is (no synthetic namespaces) | Honest to the source CSV; DCTAP has no namespace block, so undeclared-prefix notes appear at info level just as for any imported DCTAP. |
| Load behaviour | Populate-then-Create (not instant create) | Consistent with how File/URL import already behave in the dialog; lets the user rename before committing; reuses `handleCreate` unchanged. |

## Architecture

### Data source

Two source files are copied into a new folder and imported as build-time
strings via Vite `?raw`:

```
src/lib/examples/
├── index.ts                 # registry + types + File builder
└── data/
    ├── tbbt-simpledsp.tsv   # copied from yama-cli/examples/tbbt/
    └── srap-april-model.csv # the SRAP April model
```

`?raw` is chosen over `fetch()` from `static/` because the app is served
under base path `/tapir`, and raw imports sidestep base-path-aware URL
construction entirely while also removing any network round-trip.

### Registry

`src/lib/examples/index.ts` exposes a typed registry:

```ts
export interface ProfileExample {
  id: string;          // 'tbbt' | 'srap-april'
  flavor: Flavor;      // 'simpledsp' | 'dctap'
  title: string;       // card title + default project name
  description: string; // one-line card description
  fileName: string;    // e.g. 'tbbt-simpledsp.tsv' — extension drives parser
  raw: string;         // imported via ?raw
}

export const EXAMPLES: ProfileExample[];
export function getExample(id: string): ProfileExample | undefined;
export function exampleToFile(ex: ProfileExample): File;
```

`exampleToFile` builds a `File` from `raw` + `fileName` so the existing
importer can dispatch by extension exactly as it does for picked files.

Adding an example later = append one `ProfileExample` (with its `?raw`
import) to `EXAMPLES`. No UI edits required.

### Loading mechanism — reuses the real import path

Loading an example reuses the dialog's existing flow with no parser or
finalization changes:

1. `exampleToFile(ex)` → a `File`.
2. `processImportedFile(file)` — the existing function (lines 189-226 of
   `new-project-dialog.svelte`) parses via `importFile`, populates the
   preview state (detected flavor, namespaces, base IRI, warnings/errors),
   and auto-fills the project name.
3. The user reviews the populated preview and clicks the existing
   **Create** button.
4. `handleCreate` (lines 344-387) finalizes unchanged: `createProject` →
   assign parsed `descriptions` → `saveProject` → `refreshProjectsList` →
   `goto(editor)`.

Because the path is identical to file import, the SRAP example shows the
same undeclared-prefix info notes any imported DCTAP would, satisfying the
"load exactly as-is" decision.

## UI

### A. New Project dialog — third tab `File | URL | Example`

The dialog's existing segmented toggle (`activeImportTab`, line 474) gains
an `Example` segment. The `activeImportTab` type widens from
`'file' | 'url'` to `'file' | 'url' | 'example'`.

Selecting **Example** shows example cards grouped by flavor, styled like
the existing flavor-picker cards (the `border-2` buttons at lines 680-709)
so they look native. Each card shows the flavor dot (blue = SimpleDSP,
green = DCTAP), the title, and the one-line description, with a trailing
chevron.

```
File   URL   Example
─────────────────────────────────────
● SimpleDSP
┌─────────────────────────────────────┐
│ Big Bang Theory characters         →│
│ Character profile with cross-refs    │
└─────────────────────────────────────┘
● DCTAP
┌─────────────────────────────────────┐
│ SRAP — Scholarly Resource AP       →│
│ 8 shapes, COAR vocabularies          │
└─────────────────────────────────────┘
```

Clicking a card calls `processImportedFile(exampleToFile(ex))`. The
populated preview then appears in the dialog's existing shared advisory
blocks (lines 616-673). The user clicks the existing **Create** button.

### B. Dashboard empty-state quick buttons

Under the "New Project" button on the welcome screen (lines 92-99):

```
        [  + New Project  ]

     Or start from an example:
  [ Big Bang Theory ]  [ SRAP profile ]
```

Two `variant="outline" size="sm"` buttons with a `Sparkles` Lucide icon.
Clicking one opens the New Project dialog with the Example tab active and
that example already loaded into the preview, so the user is one click
from Create. The quick-button labels are deliberately terser than the
dialog card titles ("Big Bang Theory" / "SRAP profile" on the buttons vs.
"Big Bang Theory characters" / "SRAP — Scholarly Resource AP" on the
cards) to fit the compact empty-state row.

To support "open dialog pre-loaded with example X", `NewProjectDialog`
gains one optional prop:

```ts
initialExampleId?: string;
```

The dashboard sets `pendingExampleId` before flipping `showNewProject =
true`. When the dialog opens with `initialExampleId` set, it switches to
the Example tab and runs the loader for that id once on open.

### Icons & styling

- Lucide only. `Sparkles` for the example affordance on the dashboard.
- Reuse the existing flavor dot-colour convention (blue = SimpleDSP,
  green = DCTAP).
- No new toast: success is navigation to the editor (as with every other
  create path); errors surface in the dialog's existing advisory blocks.

## Error handling

- Parse failures surface through the dialog's existing `importErrors` /
  `importWarnings` advisory blocks — no new error UI.
- The `importToken` guard in `processImportedFile` already discards a
  late-arriving load if the user clicks a different example before the
  first finishes.
- `?raw` imports are resolved at build time, so a missing example file is
  a build error, not a runtime failure.

## Files

New:

- `src/lib/examples/index.ts` — registry, types, `exampleToFile`.
- `src/lib/examples/data/tbbt-simpledsp.tsv` — copied source.
- `src/lib/examples/data/srap-april-model.csv` — copied source.

Modified:

- `src/lib/components/dashboard/new-project-dialog.svelte`
  - Widen `activeImportTab` to include `'example'`; add the tab button.
  - Add the Example tab panel (cards from `EXAMPLES`).
  - Add `initialExampleId?: string` prop; on open, switch to the Example
    tab and load that example once.
  - Add a `loadExample(ex)` helper that calls
    `processImportedFile(exampleToFile(ex))`.
- `src/routes/+page.svelte`
  - Empty state: add the "Or start from an example" row with two quick
    buttons that set `pendingExampleId` and open the dialog.
  - Pass `initialExampleId={pendingExampleId}` to `<NewProjectDialog>`.
- `src/lib/version.ts` — bump beta version (project convention: increment
  on every change).

## Testing

- Unit: `exampleToFile` produces a `File` with the right name/extension;
  `getExample` returns the expected entry; both registry entries' `raw`
  text is non-empty.
- Converter sanity (already covered by existing fixtures): the SRAP CSV
  parses via the DCTAP path; TBBT TSV parses via the SimpleDSP path. Add
  a focused test that each `EXAMPLES` entry parses through `importFile`
  without errors.
- Manual / e2e: from the empty state, clicking each quick button opens the
  dialog on the Example tab with the preview populated; Create navigates to
  the editor with the expected descriptions.

## Non-goals / explicit exclusions

- No GitHub/network loading for built-in examples.
- No synthetic namespace injection for SRAP.
- No standalone examples route in this version.
