# <img src="https://yamaml.github.io/tapir/tapir-logo.png" alt="Tapir logo" width="48" height="48" align="top"> &nbsp;Tapir

**Tapir** is a browser-based, privacy-first editor for tabular metadata application profiles. It lets you author, validate, convert, and document profiles in [SimpleDSP](https://docs.yamaml.org/specs/simpledsp/spec/) and [DCTAP](https://www.dublincore.org/specifications/dctap/) without sending any data to a server.

**Live demo:** <https://yamaml.github.io/tapir>

## What Tapir does

- Author profiles in **two flavours** — SimpleDSP (with English / Japanese label support) and DCTAP — over a shared, flavour-neutral internal model.
- Three editing surfaces over the same project: a **Customized** form view, a **Smart Table**, and a **Raw Table** that mirrors the native file format.
- **Import** SimpleDSP (TSV / CSV / XLSX), DCTAP (CSV / TSV / XLSX), and YAMA YAML.
- **Export** to SimpleDSP, DCTAP, SHACL, ShEx, OWL-DSP, YAMA YAML, JSON, Frictionless Data Package, HTML/Markdown documentation, SVG/PNG/DOT diagrams, and a single-archive **Profile Package** (.zip) bundling all of the above.
- **Validate** profiles against a shared rule catalogue covering namespaces, cardinality, shape references, value-type consistency, and DCTAP-specific rules.
- **Diagram** the profile as an entity-relationship-style graph with zoom, pan, and self-reference loops.
- Multi-shape `valueShape` disjunctions (DCMI SRAP convention) — one statement → many shapes, rendered consistently across DCTAP, SHACL `sh:or`, ShEx `OR`, and OWL-DSP `owl:unionOf`.
- **Versioned snapshots** with semantic diffs ("+1 description, +3 statements"), automatic and manual.
- **100% client-side**: no server component, no telemetry, no analytics, no external fonts. Project data lives in the browser's IndexedDB. The site is a static bundle served from any HTTP host.

## Install / run locally

Tapir is a [SvelteKit](https://kit.svelte.dev) 2 / [Svelte](https://svelte.dev) 5 application built with TypeScript (strict). Requires Node.js 20 or later.

```bash
git clone https://github.com/yamaml/tapir.git
cd tapir
npm install
npm run build:vocabs   # generate the vocabulary chunks (run once, then on demand)
npm run dev            # development server on http://localhost:8081
```

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build to `build/` (static, ready to deploy anywhere) |
| `npm run preview` | Serve the production build locally |
| `npm run check` | TypeScript + Svelte type checking |
| `npm test` | Run the Vitest suite |
| `npm run build:vocabs` | Rebuild the vocabulary chunks under `static/vocabs/` |

## Deployment

Tapir is built with `@sveltejs/adapter-static` and produces a self-contained directory under `build/`. Drop it on any static host (GitHub Pages, Cloudflare Pages, Netlify, S3, …).

The base path is pinned to `/tapir` in `svelte.config.js` (`paths.base`), matching the default repo name. If you fork under a different name, change that value before building.

### GitHub Pages (automated)

`.github/workflows/deploy.yml` builds the vocab chunks, runs `npm run build`, and publishes `build/` to Pages on every push to `main`. One-time setup in the repo:

1. **Settings → Pages → Build and deployment → Source:** `GitHub Actions`.
2. Push to `main`. The workflow also picks up manual dispatches from the Actions tab.

`static/.nojekyll` is already in the tree so Pages serves the `_app/` directory verbatim.

## Architecture

```
src/
├── routes/                # SvelteKit pages
├── lib/
│   ├── components/        # UI: dashboard, editor surfaces, diagram, dialogs
│   ├── stores/            # project, ui, history, vocab, theme
│   ├── converters/        # parsers & generators (one file per format)
│   ├── vocab/             # vocab loader + search index
│   ├── db/                # IndexedDB wrapper (idb)
│   ├── types/             # profile model + flavor labels
│   └── utils/             # validation, IRI helpers, file I/O, drag-reorder
├── tests/                 # Vitest converter + util + db tests
└── static/
    ├── vocabs/            # pre-built JSON vocabulary chunks (75)
    └── tapir-logo.svg
```

The converter layer is pure TypeScript with no DOM or persistence dependencies, and is shared with the [yama-cli](https://github.com/yamaml/yama-cli) command-line tool, so a profile round-tripped between Tapir and the CLI is byte-identical.

## Specifications

Tapir reads and writes the formats defined at:

- **SimpleDSP** — <https://docs.yamaml.org/specs/simpledsp/spec/>
- **OWL-DSP** — <https://docs.yamaml.org/specs/owl-dsp/spec/>
- **DCTAP** — <https://www.dublincore.org/specifications/dctap/>
- **YAMAML** — <https://docs.yamaml.org/specs/yamaml/spec/>
- **SHACL** — <https://www.w3.org/TR/shacl/>
- **ShEx** — <https://shex.io/>

## Privacy

- Tapir does not track you. There is no analytics, telemetry, error reporting, or external font CDN.
- All editing happens in your browser. Project data is stored locally in IndexedDB.
- The only network requests Tapir makes are to its own static origin (loading vocabulary JSON chunks on demand).
- See the footer of any page for direct links to the SimpleDSP and DCTAP specs.

## Licence

[MIT](./LICENSE) © 2026 Nishad Thalhath and contributors

### Bundled fonts

Tapir ships two fonts, both under the [SIL Open Font License 1.1](./static/fonts/Inter-LICENSE.txt):

- [Inter](https://rsms.me/inter/) (v4.1) — UI body text, card titles, form labels.
- [JetBrains Mono](https://www.jetbrains.com/mono/) (v2.304) — property IRIs, code, and anything shown as `.font-mono` in the UI.

The TTF files live under `static/fonts/` and are used both in the UI (via `@fontsource-variable/*`) and embedded into exported diagram PDFs so text stays vector-selectable and visually consistent across outputs.

### Icon

The Tapir icon is by [Saeful Muslim](https://thenounproject.com/creator/rebelsaeful/) and is used under a Royalty-Free License through [the Noun Project](https://thenounproject.com/about/).
