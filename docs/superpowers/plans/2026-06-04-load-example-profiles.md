# Load Example Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users load a ready-made example profile (one SimpleDSP, one DCTAP) through Tapir's existing import path, from both the New Project dialog and the dashboard empty state.

**Architecture:** Two example source files are vendored into `src/lib/examples/data/` and imported as build-time strings via Vite `?raw`. A typed registry (`src/lib/examples/index.ts`) lists each example and builds a `File` from its raw text. Loading reuses the dialog's existing `processImportedFile` → `handleCreate` flow, so examples behave identically to a user-imported file. Two entry points: an `Example` tab in `new-project-dialog.svelte`, and two quick buttons on the dashboard empty state that open the dialog pre-loaded via a new `initialExampleId` prop.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript strict, Vitest (jsdom), Vite `?raw` imports, Tailwind CSS 4, bits-ui, Lucide icons.

**Reference spec:** `docs/superpowers/specs/2026-06-04-load-example-profiles-design.md`

**Conventions to follow (from CLAUDE.md):**
- Lucide icons only; bits-ui/shadcn-svelte styling; pixel-perfect, not generic.
- TSDoc on all exports with `@param`/`@returns`/`@example`; `// ── Section ──` headers; strict TS (no `any`); barrel exports per directory; small focused files.
- Flavor labels: never call SimpleDSP templates "shapes".
- Commit messages: Conventional Commits, lowercase, no period, no AI attribution. Valid types: feat, fix, build, chore, ci, docs, style, refactor, perf, test.
- Increment `src/lib/version.ts` beta on every change.
- Build/test commands need PATH setup: `export PATH="$HOME/.deno/bin:$PATH"; eval "$(fnm env)"` then run `npx` commands from inside `tapir/`.

**Pre-flight (verify Tapir is a git repo before any commit step):**
Run from `tapir/`: `git rev-parse --is-inside-work-tree`. If it prints `true`, commit as written. If it errors (not a repo), SKIP every commit step and tell the user the work is staged-in-tree only (workshop root is not a repo per CLAUDE.md; Tapir may or may not be one).

---

## File Structure

New files:
- `src/lib/examples/data/tbbt-simpledsp.tsv` — copied SimpleDSP source (verbatim from `../yama-cli/examples/tbbt/tbbt-simpledsp.tsv`).
- `src/lib/examples/data/srap-april-model.csv` — copied DCTAP source (verbatim from `tests/fixtures/srap-april-model.csv`).
- `src/lib/examples/index.ts` — `ProfileExample` type, `EXAMPLES` array, `getExample`, `exampleToFile`. Barrel for the directory.
- `tests/examples/registry.test.ts` — unit tests for the registry and each example's parseability.

Modified files:
- `src/lib/components/dashboard/new-project-dialog.svelte` — add `Example` tab, example cards, `initialExampleId` prop, `loadExample` helper.
- `src/routes/+page.svelte` — add empty-state quick buttons + `pendingExampleId` state; pass `initialExampleId` to the dialog.
- `src/lib/version.ts` — bump beta.

---

## Task 1: Vendor the example source files

**Files:**
- Create: `src/lib/examples/data/tbbt-simpledsp.tsv`
- Create: `src/lib/examples/data/srap-april-model.csv`

- [ ] **Step 1: Copy the two source files verbatim**

Run from `tapir/`:

```bash
mkdir -p src/lib/examples/data
cp ../yama-cli/examples/tbbt/tbbt-simpledsp.tsv src/lib/examples/data/tbbt-simpledsp.tsv
cp tests/fixtures/srap-april-model.csv src/lib/examples/data/srap-april-model.csv
```

- [ ] **Step 2: Verify both files copied and are non-empty**

Run from `tapir/`:

```bash
wc -l src/lib/examples/data/tbbt-simpledsp.tsv src/lib/examples/data/srap-april-model.csv
```

Expected: `tbbt-simpledsp.tsv` ~32 lines, `srap-april-model.csv` ~89 lines, both > 0.

- [ ] **Step 3: Confirm the TSV is tab-separated (not space-mangled by copy)**

Run from `tapir/`:

```bash
grep -c $'\t' src/lib/examples/data/tbbt-simpledsp.tsv
```

Expected: a number ≥ 20 (most data rows contain tabs). If it prints `0`, the copy mangled tabs — re-copy with `cp` (not a clipboard paste).

- [ ] **Step 4: Commit** (skip if not a git repo — see Pre-flight)

```bash
git add src/lib/examples/data/tbbt-simpledsp.tsv src/lib/examples/data/srap-april-model.csv
git commit -m "chore(examples): vendor tbbt and srap example source files"
```

---

## Task 2: Type declaration for `?raw` imports

Vite resolves `?raw` imports at build time, but TypeScript needs an ambient module declaration so `import x from './foo.tsv?raw'` type-checks as `string`. Tapir uses `svelte-check`, so this must be declared.

**Files:**
- Modify: `src/app.d.ts` (append a module declaration)

- [ ] **Step 1: Check whether a `?raw` declaration already exists**

Run from `tapir/`:

```bash
grep -rn "raw" src/app.d.ts
```

Expected: no match (no existing declaration). If a `*?raw` declaration already exists, skip Step 2.

- [ ] **Step 2: Append the ambient declaration to `src/app.d.ts`**

Add at the end of the file (outside the existing `declare global { ... }` block — these are top-level module declarations):

```ts
// ── Vite ?raw imports ───────────────────────────────────────────
// Importing a file with the `?raw` suffix yields its text content as
// a string, resolved at build time. Used for bundled example profiles.
declare module '*?raw' {
	const content: string;
	export default content;
}
```

- [ ] **Step 3: Verify type-check still passes**

Run from `tapir/` (with PATH set up):

```bash
export PATH="$HOME/.deno/bin:$PATH"; eval "$(fnm env)"
npx svelte-check --threshold error
```

Expected: no new errors (pre-existing count unchanged per CLAUDE.md).

- [ ] **Step 4: Commit** (skip if not a git repo)

```bash
git add src/app.d.ts
git commit -m "build(examples): declare ambient type for vite ?raw imports"
```

---

## Task 3: Example registry — types, data, and `exampleToFile`

**Files:**
- Create: `src/lib/examples/index.ts`
- Test: `tests/examples/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/examples/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EXAMPLES, getExample, exampleToFile } from '$lib/examples';
import { parseSimpleDsp } from '$lib/converters/simpledsp-parser';
import { parseCsvRows, isDctapFormat } from '$lib/components/editor/import-handler';
import { dctapRowsToTapir, type DctapRow } from '$lib/converters/dctap-parser';

// ── Registry shape ──────────────────────────────────────────────

describe('EXAMPLES registry', () => {
	it('contains at least one SimpleDSP and one DCTAP example', () => {
		expect(EXAMPLES.some((e) => e.flavor === 'simpledsp')).toBe(true);
		expect(EXAMPLES.some((e) => e.flavor === 'dctap')).toBe(true);
	});

	it('every example has a unique id and non-empty raw content', () => {
		const ids = EXAMPLES.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const e of EXAMPLES) {
			expect(e.raw.trim().length).toBeGreaterThan(0);
			expect(e.title.length).toBeGreaterThan(0);
			expect(e.description.length).toBeGreaterThan(0);
		}
	});

	it('every example fileName extension matches its flavor', () => {
		for (const e of EXAMPLES) {
			if (e.flavor === 'simpledsp') expect(e.fileName.endsWith('.tsv')).toBe(true);
			if (e.flavor === 'dctap') expect(e.fileName.endsWith('.csv')).toBe(true);
		}
	});
});

// ── getExample ──────────────────────────────────────────────────

describe('getExample', () => {
	it('returns the matching example by id', () => {
		const first = EXAMPLES[0];
		expect(getExample(first.id)?.id).toBe(first.id);
	});

	it('returns undefined for an unknown id', () => {
		expect(getExample('does-not-exist')).toBeUndefined();
	});
});

// ── exampleToFile ───────────────────────────────────────────────

describe('exampleToFile', () => {
	it('builds a File carrying the example fileName and raw content', async () => {
		const ex = EXAMPLES[0];
		const file = exampleToFile(ex);
		expect(file).toBeInstanceOf(File);
		expect(file.name).toBe(ex.fileName);
		expect(await file.text()).toBe(ex.raw);
	});
});

// ── Each example parses through its converter ───────────────────

describe('example content is parseable', () => {
	it('the SimpleDSP example parses without errors', () => {
		const ex = EXAMPLES.find((e) => e.flavor === 'simpledsp')!;
		const { data, errors } = parseSimpleDsp(ex.raw, ex.title);
		expect(errors).toHaveLength(0);
		expect(data.descriptions.length).toBeGreaterThan(0);
	});

	it('the DCTAP example parses without errors', () => {
		const ex = EXAMPLES.find((e) => e.flavor === 'dctap')!;
		const rows = parseCsvRows(ex.raw, ',');
		const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
		expect(isDctapFormat(headers)).toBe(true);
		const { data, errors } = dctapRowsToTapir(rows as DctapRow[], ex.title);
		expect(errors).toHaveLength(0);
		expect(data.descriptions.length).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `tapir/`:

```bash
export PATH="$HOME/.deno/bin:$PATH"; eval "$(fnm env)"
npx vitest run tests/examples/registry.test.ts
```

Expected: FAIL — cannot resolve `$lib/examples` (module not created yet).

- [ ] **Step 3: Create the registry**

Create `src/lib/examples/index.ts`:

```ts
/**
 * Built-in example profiles.
 *
 * Example source files live in `./data/` and are imported as build-time
 * strings via Vite's `?raw` suffix. This keeps examples fully offline
 * (no `fetch`, no base-path handling) and routes them through the same
 * import path a user-picked file would take.
 */
import type { Flavor } from '$lib/types';
import tbbtSimpledsp from './data/tbbt-simpledsp.tsv?raw';
import srapAprilModel from './data/srap-april-model.csv?raw';

// ── Types ───────────────────────────────────────────────────────

/** A bundled example application profile. */
export interface ProfileExample {
	/** Stable identifier, used by the dashboard quick buttons. */
	id: string;
	/** Which flavor this example is authored in. */
	flavor: Flavor;
	/** Card title; also the default project name when loaded. */
	title: string;
	/** One-line description shown on the example card. */
	description: string;
	/**
	 * File name presented to the importer. The extension determines
	 * which parser runs (`.tsv` → SimpleDSP, `.csv` → DCTAP).
	 */
	fileName: string;
	/** Raw file content, imported at build time via `?raw`. */
	raw: string;
}

// ── Registry ────────────────────────────────────────────────────

/**
 * The example profiles offered in the UI. Add an entry (plus its
 * `?raw` import above) to ship another example — no UI changes needed.
 */
export const EXAMPLES: ProfileExample[] = [
	{
		id: 'tbbt',
		flavor: 'simpledsp',
		title: 'Big Bang Theory characters',
		description: 'Character profile with cross-references between people.',
		fileName: 'tbbt-simpledsp.tsv',
		raw: tbbtSimpledsp,
	},
	{
		id: 'srap-april',
		flavor: 'dctap',
		title: 'SRAP — Scholarly Resource AP',
		description: 'Eight shapes, COAR vocabularies, multi-shape references.',
		fileName: 'srap-april-model.csv',
		raw: srapAprilModel,
	},
];

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Looks up an example by id.
 *
 * @param id - The example id (e.g. `'tbbt'`).
 * @returns The matching example, or `undefined` if none.
 *
 * @example
 * const ex = getExample('srap-april');
 */
export function getExample(id: string): ProfileExample | undefined {
	return EXAMPLES.find((e) => e.id === id);
}

/**
 * Builds a `File` from an example so it can be fed to the existing
 * importer exactly like a user-picked file.
 *
 * @param ex - The example to wrap.
 * @returns A `File` carrying the example's raw text and file name.
 *
 * @example
 * const file = exampleToFile(getExample('tbbt')!);
 * await processImportedFile(file);
 */
export function exampleToFile(ex: ProfileExample): File {
	return new File([ex.raw], ex.fileName, { type: 'text/plain' });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `tapir/`:

```bash
export PATH="$HOME/.deno/bin:$PATH"; eval "$(fnm env)"
npx vitest run tests/examples/registry.test.ts
```

Expected: PASS — all describe blocks green.

- [ ] **Step 5: Type-check**

Run from `tapir/`:

```bash
npx svelte-check --threshold error
```

Expected: no new errors.

- [ ] **Step 6: Commit** (skip if not a git repo)

```bash
git add src/lib/examples/index.ts tests/examples/registry.test.ts
git commit -m "feat(examples): add example profile registry"
```

---

## Task 4: Add the `Example` tab and cards to the New Project dialog

**Files:**
- Modify: `src/lib/components/dashboard/new-project-dialog.svelte`

This task wires the dialog. The dialog already has `processImportedFile` (parses a `File` into the preview state) and `handleCreate` (finalizes the project). We add a third import tab and example cards that call `processImportedFile(exampleToFile(ex))`. No changes to `handleCreate`.

- [ ] **Step 1: Import the registry and a Sparkles icon**

In the `<script lang="ts">` block, alongside the existing imports (the import-handler import is at line ~11, Lucide icons at lines ~31-39), add:

```ts
	import { EXAMPLES, exampleToFile, getExample, type ProfileExample } from '$lib/examples';
	import Sparkles from 'lucide-svelte/icons/sparkles';
```

- [ ] **Step 2: Add the optional `initialExampleId` prop**

Find the `Props` interface and the `$props()` destructure (currently around lines 41-45):

```ts
	interface Props {
		open: boolean;
	}

	let { open = $bindable() }: Props = $props();
```

Replace with:

```ts
	interface Props {
		open: boolean;
		/**
		 * If set when the dialog opens, switch to the Example tab and
		 * load this example into the preview automatically.
		 */
		initialExampleId?: string;
	}

	let { open = $bindable(), initialExampleId }: Props = $props();
```

- [ ] **Step 3: Widen the import-tab state to include `'example'`**

Find (around line 75):

```ts
	let activeImportTab = $state<'file' | 'url'>('file');
```

Replace with:

```ts
	let activeImportTab = $state<'file' | 'url' | 'example'>('file');
```

- [ ] **Step 4: Add the `loadExample` helper**

Place it next to `handleFileSelect` / `handleUrlLoad` (around line 289, after `handleFileSelect`):

```ts
	/**
	 * Loads a bundled example into the dialog preview by routing its
	 * raw content through the same import path a picked file uses.
	 */
	async function loadExample(ex: ProfileExample): Promise<void> {
		await processImportedFile(exampleToFile(ex));
	}
```

- [ ] **Step 5: Auto-load when opened with `initialExampleId`**

Add a `$effect` after the `$props()` line / state declarations (anywhere in the top-level script after `loadExample` is defined is fine in Svelte 5, effects are hoisted by reactivity, but place it after the helper for readability). Add:

```ts
	// When opened with a preselected example (from the dashboard quick
	// buttons), jump to the Example tab and load it once per open.
	let loadedExampleForOpen = $state(false);
	$effect(() => {
		if (open && initialExampleId && !loadedExampleForOpen) {
			const ex = getExample(initialExampleId);
			if (ex) {
				activeImportTab = 'example';
				loadExample(ex);
			}
			loadedExampleForOpen = true;
		}
		if (!open) {
			loadedExampleForOpen = false;
		}
	});
```

- [ ] **Step 5b: Reset the active tab in `resetForm`**

`resetForm()` (around line 159) runs when the dialog closes (via `onOpenChange`) but does not currently reset `activeImportTab`. Without this, opening from a dashboard quick button (which leaves the tab on `'example'`), then later clicking plain "New Project", would still show the Example tab. Find the `resetForm` function body and, just before the closing `}` (after `clearImport();`), add:

```ts
		activeImportTab = 'file';
```

So the function becomes:

```ts
	function resetForm() {
		projectName = '';
		selectedFlavor = 'simpledsp';
		baseIri = '';
		projectNamespaces = {};
		creating = false;
		newPrefix = '';
		newUri = '';
		clearImport();
		activeImportTab = 'file';
	}
```

- [ ] **Step 6: Add the `Example` tab button**

Find the tab toggle (the `role="tablist"` div at lines ~474-493) containing the `File` and `URL` buttons. After the `URL` button's closing `</button>` and before the tablist's closing `</div>`, add:

```svelte
						<button
							type="button"
							role="tab"
							aria-selected={activeImportTab === 'example'}
							class="px-3 h-7 text-xs rounded-sm transition-colors {activeImportTab === 'example' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
							onclick={() => (activeImportTab = 'example')}
						>
							Example
						</button>
```

- [ ] **Step 7: Add the Example tab panel**

The dialog renders the file panel under `{#if activeImportTab === 'file'}` and the URL panel under `{:else if activeImportTab === 'url'}` (these `{#if}`/`{:else if}` blocks are inside the Import section, ending before the shared advisory blocks at line ~616). Find the `{/if}` that closes the URL panel (just before the `<!-- Shared advisory blocks` comment at line ~616) and insert a new branch before that closing `{/if}`:

```svelte
					{:else if activeImportTab === 'example'}
						<div class="grid gap-3">
							{#each ['simpledsp', 'dctap'] as const as flavor}
								{@const items = EXAMPLES.filter((e) => e.flavor === flavor)}
								{#if items.length > 0}
									<div class="grid gap-1.5">
										<div class="flex items-center gap-2">
											<div class="h-2.5 w-2.5 rounded-full {flavor === 'simpledsp' ? 'bg-blue-500' : 'bg-green-500'}"></div>
											<span class="text-xs font-medium text-muted-foreground">
												{flavor === 'simpledsp' ? 'SimpleDSP' : 'DCTAP'}
											</span>
										</div>
										{#each items as ex (ex.id)}
											<button
												type="button"
												class="group flex items-center gap-3 rounded-lg border-2 border-border p-3 text-left transition-colors hover:border-muted-foreground/30 {importedFile?.name === ex.fileName ? (flavor === 'simpledsp' ? 'border-blue-500 bg-blue-500/10' : 'border-green-500 bg-green-500/10') : ''}"
												onclick={() => loadExample(ex)}
											>
												<div class="min-w-0 flex-1">
													<div class="text-sm font-medium text-foreground">{ex.title}</div>
													<p class="mt-0.5 text-xs text-muted-foreground leading-snug">{ex.description}</p>
												</div>
												<Sparkles class="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
											</button>
										{/each}
									</div>
								{/if}
							{/each}
						</div>
```

Note: the selected-state highlight keys off `importedFile?.name === ex.fileName`, which `processImportedFile` sets. This mirrors how File/URL show their loaded state and needs no extra state variable.

- [ ] **Step 8: Type-check and run the full test suite**

Run from `tapir/`:

```bash
export PATH="$HOME/.deno/bin:$PATH"; eval "$(fnm env)"
npx svelte-check --threshold error && npx vitest run
```

Expected: no new type errors; all tests pass.

- [ ] **Step 9: Manual smoke test (dev server)**

Run from `tapir/`:

```bash
fuser -k 8081/tcp 2>/dev/null; npx vite dev --port 8081 --host
```

Open the app, click **New Project**, click the **Example** tab. Verify: two flavor groups with one card each; clicking the SimpleDSP card populates the preview (name auto-fills "tbbt-simpledsp", flavor shows SimpleDSP, namespaces appear); clicking the DCTAP card switches to a DCTAP preview (info notes about undeclared prefixes may appear — expected). Click **Create** and confirm it opens the editor with descriptions. Stop the server (Ctrl+C) when done.

- [ ] **Step 10: Commit** (skip if not a git repo)

```bash
git add src/lib/components/dashboard/new-project-dialog.svelte
git commit -m "feat(examples): add example tab to new project dialog"
```

---

## Task 5: Add dashboard empty-state quick buttons

**Files:**
- Modify: `src/routes/+page.svelte`

The empty state (lines ~84-101) currently shows one "New Project" button that sets `showNewProject = true`. We add a second row of two quick buttons that preselect an example, then open the dialog. The dialog already accepts `initialExampleId` (Task 4).

- [ ] **Step 1: Add a Sparkles icon import and `pendingExampleId` state**

In the `<script>` block of `src/routes/+page.svelte`, add to the Lucide imports (find the existing `import FileText ...` / `import Plus ...` lines):

```ts
	import Sparkles from 'lucide-svelte/icons/sparkles';
```

Add a state variable next to the existing `showNewProject` declaration (search for `showNewProject`):

```ts
	let pendingExampleId = $state<string | undefined>(undefined);
```

- [ ] **Step 2: Add a helper to open the dialog with an example**

Add near the other handlers in the script:

```ts
	/** Preselects an example, then opens the New Project dialog on its Example tab. */
	function openWithExample(id: string) {
		pendingExampleId = id;
		showNewProject = true;
	}
```

- [ ] **Step 3: Pass `initialExampleId` and reset it when the dialog closes**

Find where the dialog is rendered (search for `<NewProjectDialog`). It is currently `<NewProjectDialog bind:open={showNewProject} />`. The dialog has no `onClose` prop and we are not adding one — instead reset `pendingExampleId` reactively when `showNewProject` goes false. Replace the render with:

```svelte
<NewProjectDialog bind:open={showNewProject} initialExampleId={pendingExampleId} />
```

and add this effect in the script, after the state declarations:

```ts
	// Clear the preselected example once the dialog has closed so the
	// next plain "New Project" open starts blank.
	$effect(() => {
		if (!showNewProject) pendingExampleId = undefined;
	});
```

- [ ] **Step 4: Add the quick-button row to the empty state**

Find the empty-state `New Project` button block (lines ~92-99):

```svelte
			<div class="mt-8">
				<Button size="lg" onclick={() => (showNewProject = true)}>
					<Plus class="mr-2 h-5 w-5" />
					New Project
				</Button>
			</div>
```

Replace with:

```svelte
			<div class="mt-8">
				<Button size="lg" onclick={() => (showNewProject = true)}>
					<Plus class="mr-2 h-5 w-5" />
					New Project
				</Button>
			</div>
			<div class="mt-6">
				<p class="text-xs text-muted-foreground">Or start from an example:</p>
				<div class="mt-2 flex flex-wrap items-center justify-center gap-2">
					<Button variant="outline" size="sm" onclick={() => openWithExample('tbbt')}>
						<Sparkles class="mr-1.5 h-4 w-4" />
						Big Bang Theory
					</Button>
					<Button variant="outline" size="sm" onclick={() => openWithExample('srap-april')}>
						<Sparkles class="mr-1.5 h-4 w-4" />
						SRAP profile
					</Button>
				</div>
			</div>
```

- [ ] **Step 5: Type-check**

Run from `tapir/`:

```bash
export PATH="$HOME/.deno/bin:$PATH"; eval "$(fnm env)"
npx svelte-check --threshold error
```

Expected: no new errors.

- [ ] **Step 6: Manual smoke test**

Run the dev server (`fuser -k 8081/tcp 2>/dev/null; npx vite dev --port 8081 --host`). With no projects (or in a fresh browser profile / cleared IndexedDB), the empty state shows "Or start from an example" with two buttons. Click **Big Bang Theory** → dialog opens on the Example tab with the TBBT card highlighted and preview populated. Close the dialog, click **New Project** → dialog opens blank on the File tab (confirms reset). Stop the server.

- [ ] **Step 7: Commit** (skip if not a git repo)

```bash
git add src/routes/+page.svelte
git commit -m "feat(examples): add example quick buttons to dashboard empty state"
```

---

## Task 6: Bump version and final verification

**Files:**
- Modify: `src/lib/version.ts`

- [ ] **Step 1: Bump the beta version**

Edit `src/lib/version.ts`. Change:

```ts
export const VERSION = '0.1.7-beta.92';
```

to:

```ts
export const VERSION = '0.1.7-beta.93';
```

(If the current value is higher than `beta.92` because of intervening work, increment whatever is there by one.)

- [ ] **Step 2: Full verification — type-check, tests, build**

Run from `tapir/`:

```bash
export PATH="$HOME/.deno/bin:$PATH"; eval "$(fnm env)"
npx svelte-check --threshold error && npx vitest run && npx vite build
```

Expected: type-check clean (no new errors), all tests pass, build succeeds. The build is the real proof that the `?raw` imports resolve correctly in a production bundle.

- [ ] **Step 3: Commit** (skip if not a git repo)

```bash
git add src/lib/version.ts
git commit -m "chore: bump version to 0.1.7-beta.93"
```

---

## Verification checklist (run after all tasks)

- [ ] `npx vitest run` — all tests pass, including `tests/examples/registry.test.ts`.
- [ ] `npx svelte-check --threshold error` — no new errors.
- [ ] `npx vite build` — succeeds (proves `?raw` bundling works).
- [ ] Empty state shows two example quick buttons; each opens the dialog pre-loaded.
- [ ] Dialog Example tab shows one SimpleDSP and one DCTAP card; clicking loads the preview.
- [ ] Creating from an example opens the editor with the expected descriptions.
- [ ] SimpleDSP example loads clean; DCTAP (SRAP) loads as-is with info-level prefix notes (expected, not an error).
- [ ] Plain "New Project" still opens blank (example preselection cleared on close).
