<script lang="ts">
	import type { TapirProject } from '$lib/types';
	import { getFlavorLabels } from '$lib/types';
	import { validateProject } from '$lib/utils/validation';
	import { getCachedVocab } from '$lib/vocab/vocab-loader';
	import { selectedDescriptionId, simpleDspLang } from '$lib/stores';
	import { Badge } from '$lib/components/ui/badge';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import CircleAlert from 'lucide-svelte/icons/circle-alert';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import HelpCircle from 'lucide-svelte/icons/circle-help';
	import X from 'lucide-svelte/icons/x';
	import Tip from '$lib/components/ui/tip.svelte';

	/**
	 * Maps a validation message to a one-line rule explanation suitable
	 * for a tooltip. Pattern-matches on stable phrasing produced by
	 * `validateProject` / `validateStatementVocab` — adding a new rule
	 * requires an entry here, otherwise the row stays untooltipped (no
	 * regression for unknown messages).
	 *
	 * Intentional design choice: we do **not** hard-code rule codes in
	 * the validator's emission path. Tying tooltips to message prefixes
	 * keeps the validator small and lets us evolve copy here.
	 *
	 * Tooltip copy is flavor-aware: the shape/template terms come from
	 * the active flavor labels, so SimpleDSP never reads "shape". In
	 * SimpleDSP JP mode the validator emits Japanese messages, which
	 * deliberately match none of these English prefixes — the rows show
	 * without tooltips rather than mixing languages.
	 */
	function ruleHelp(message: string): string | undefined {
		const descTerm = labels.descriptionSingular.toLowerCase();
		if (message.startsWith('Unknown prefix ')) {
			return 'The prefix used in this term is not declared in the project namespaces. Add it via the undeclared-prefixes banner or the Namespaces panel.';
		}
		if (message.startsWith('Invalid cardinality: min')) {
			return 'A statement cannot require more occurrences than it allows. Lower min or raise max.';
		}
		if (message.startsWith('Min must be')) {
			return 'Cardinality must be a non-negative integer. Use 0 for "optional" or 1 for "required".';
		}
		if (message.startsWith('Max must be')) {
			return 'Cardinality must be a non-negative integer. Leave Max blank for "unbounded".';
		}
		if (message.includes('does not match any')) {
			return `The referenced name is not defined in this profile. Add a ${descTerm} with that name, or correct the reference.`;
		}
		if (message.includes('declares an ID prefix but has no target class')) {
			return 'An ID prefix only makes sense alongside a target class — together they define the URI pattern of records.';
		}
		if (message.includes('ID prefix') && message.includes('is not declared')) {
			return 'The ID prefix needs a matching namespace declaration so the converters can expand record URIs.';
		}
		if (message.startsWith('Duplicate ')) {
			return 'Names must be unique within a profile. Rename one of the duplicates.';
		}
		if (message.includes('should not carry a datatype')) {
			return 'IRI references identify entities, not literal values, so a datatype constraint has no meaning here.';
		}
		if (message.includes('should not carry a') && message.includes('reference')) {
			return `Literal values cannot reference a ${descTerm}. Switch the value type to a structured/IRI form, or drop the reference.`;
		}
		if (message.includes('both a') && message.includes('reference and a class constraint')) {
			return `Pick one: a ${descTerm} reference constrains the value to a defined template; a class constraint requires only class membership. Both together is ambiguous.`;
		}
		if (message.includes('DCTAP statement with a constraint should declare a valueNodeType')) {
			return 'When a constraint is given, the value node type tells consumers how to interpret it (literal vs IRI vs bnode).';
		}
		if (message.includes('has no statements')) {
			return `A ${descTerm} with no statements imposes no constraints — usually a sign of an unfinished template. Add at least one statement, or delete it.`;
		}
		if (message.includes('has no property ID')) {
			return 'Every statement must constrain a specific RDF property. Set the propertyID field.';
		}
		if (message.includes('has no name')) {
			return `Every ${descTerm} needs an identifier so other statements can reference it.`;
		}
		if (message.includes('Profile has no')) {
			return `A profile must have at least one ${descTerm} to be meaningful.`;
		}
		if (message.includes('SimpleDSP profile must open with a [MAIN] block')) {
			return 'SimpleDSP requires the first block to be named [MAIN] — it is the entry point for records.';
		}
		if (message.includes('range is') && message.includes('but datatype is')) {
			return 'The property\'s declared range (from its vocabulary) and the datatype on this statement disagree. Either adjust the datatype or use a property whose range covers it.';
		}
		if (message.startsWith('Property') && message.includes('expects a literal')) {
			return 'The property\'s declared range is a literal type, but the statement is set to IRI. Switch the value type to literal.';
		}
		if (message.startsWith('Property') && message.includes('expects')) {
			return 'The property\'s declared range from its vocabulary differs from how the statement is configured. Reconcile the value type with the property\'s range.';
		}
		return undefined;
	}

	interface Props {
		project: TapirProject;
		open: boolean;
		onclose: () => void;
	}

	let { project, open = $bindable(), onclose }: Props = $props();

	let labels = $derived(getFlavorLabels(project.flavor, $simpleDspLang));

	// Pass the cached-vocab lookup so the panel surfaces Tier-2
	// property-range / property-domain coherence warnings alongside
	// the existing syntactic checks. The lookup is read-only and
	// silently returns undefined for prefixes whose chunk hasn't
	// loaded yet, so unknown vocabs produce zero false positives.
	// The active SimpleDSP language selects the message catalogue.
	let result = $derived(validateProject(project, { getCachedVocab }, $simpleDspLang));
	let errorCount = $derived(result.errors.length);
	let warningCount = $derived(result.warnings.length);
	let isClean = $derived(errorCount === 0 && warningCount === 0);

	function navigateTo(field?: string) {
		if (!field) return;
		const descName = field.split('.')[0];
		const desc = project.descriptions.find((d) => d.name === descName);
		if (desc) {
			selectedDescriptionId.set(desc.id);
		}
	}
</script>

{#if open}
	<!--
		Bottom-anchored validation panel. Docks below the editor content, spans
		the full width, and can be dismissed with the close button or Escape.
	-->
	<div
		class="relative flex shrink-0 flex-col border-t border-border bg-background"
		style="height: 280px;"
		role="region"
		aria-label="Validation report"
	>
		<div class="flex items-center justify-between border-b border-border px-4 py-2">
			<div class="flex items-center gap-2">
				<span class="text-sm font-medium text-foreground">Validation</span>
				{#if errorCount > 0}
					<Badge variant="destructive" class="text-[10px] px-1.5 py-0 h-5">
						{errorCount} {errorCount === 1 ? 'error' : 'errors'}
					</Badge>
				{/if}
				{#if warningCount > 0}
					<Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-5">
						{warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
					</Badge>
				{/if}
				{#if isClean}
					<Badge variant="outline" class="text-[10px] px-1.5 py-0 h-5 text-green-600">
						No issues
					</Badge>
				{/if}
			</div>
			<button
				type="button"
				class="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				onclick={() => {
					open = false;
					onclose();
				}}
				aria-label="Close validation panel"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>

		<ScrollArea class="flex-1 min-h-0">
			<div class="space-y-0.5 px-4 py-3">
				{#if isClean}
					<div class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
						<CircleCheck class="h-4 w-4 shrink-0 text-green-600" />
						<span>Profile is valid. No errors or warnings found.</span>
					</div>
				{/if}

				{#each result.errors as err}
					{@const help = ruleHelp(err.message)}
					<div class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent">
						<CircleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
						<button
							type="button"
							class="flex-1 min-w-0 text-left"
							onclick={() => navigateTo(err.field)}
						>
							{#if err.field}
								<span class="font-mono text-[10px] text-muted-foreground">{err.field}</span>
								<span class="mx-1 text-muted-foreground/50">&mdash;</span>
							{/if}
							<span class="text-foreground">{err.message}</span>
						</button>
						{#if help}
							<Tip text={help}>
								<button
									type="button"
									class="mt-0.5 shrink-0 text-muted-foreground/50 hover:text-muted-foreground focus-visible:text-muted-foreground transition-colors [&_svg]:pointer-events-none"
									aria-label="Help"
								>
									<HelpCircle class="h-3.5 w-3.5" />
								</button>
							</Tip>
						{/if}
					</div>
				{/each}

				{#each result.warnings as warn}
					{@const help = ruleHelp(warn.message)}
					<div class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent">
						<TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
						<button
							type="button"
							class="flex-1 min-w-0 text-left"
							onclick={() => navigateTo(warn.field)}
						>
							{#if warn.field}
								<span class="font-mono text-[10px] text-muted-foreground">{warn.field}</span>
								<span class="mx-1 text-muted-foreground/50">&mdash;</span>
							{/if}
							<span class="text-foreground">{warn.message}</span>
						</button>
						{#if help}
							<Tip text={help}>
								<button
									type="button"
									class="mt-0.5 shrink-0 text-muted-foreground/50 hover:text-muted-foreground focus-visible:text-muted-foreground transition-colors [&_svg]:pointer-events-none"
									aria-label="Help"
								>
									<HelpCircle class="h-3.5 w-3.5" />
								</button>
							</Tip>
						{/if}
					</div>
				{/each}
			</div>
		</ScrollArea>
	</div>
{/if}
