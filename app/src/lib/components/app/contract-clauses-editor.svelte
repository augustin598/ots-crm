<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	interface ContractClause {
		number: string;
		title: string;
		paragraphs: string[];
	}

	let {
		clauses = $bindable<ContractClause[]>([]),
		defaultClauses = [] as ContractClause[],
		readonly = false
	}: {
		clauses: ContractClause[];
		defaultClauses?: ContractClause[];
		readonly?: boolean;
	} = $props();

	let openSections = $state<Set<string>>(new Set());

	function toggleSection(number: string) {
		const next = new Set(openSections);
		if (next.has(number)) {
			next.delete(number);
		} else {
			next.add(number);
		}
		openSections = next;
	}

	function expandAll() {
		openSections = new Set(clauses.map((c) => c.number));
	}

	function collapseAll() {
		openSections = new Set();
	}

	function updateClauseTitle(index: number, title: string) {
		clauses = clauses.map((c, i) => (i === index ? { ...c, title } : c));
	}

	function updateParagraph(clauseIndex: number, paragraphIndex: number, text: string) {
		clauses = clauses.map((c, i) =>
			i === clauseIndex
				? { ...c, paragraphs: c.paragraphs.map((p, j) => (j === paragraphIndex ? text : p)) }
				: c
		);
	}

	function addParagraph(clauseIndex: number) {
		clauses = clauses.map((c, i) =>
			i === clauseIndex ? { ...c, paragraphs: [...c.paragraphs, ''] } : c
		);
	}

	function removeParagraph(clauseIndex: number, paragraphIndex: number) {
		clauses = clauses.map((c, i) =>
			i === clauseIndex
				? { ...c, paragraphs: c.paragraphs.filter((_, j) => j !== paragraphIndex) }
				: c
		);
	}

	function resetClause(index: number) {
		const clause = clauses[index];
		const defaultClause = defaultClauses.find((d) => d.number === clause.number);
		if (defaultClause) {
			clauses = clauses.map((c, i) =>
				i === index ? { ...defaultClause, paragraphs: [...defaultClause.paragraphs] } : c
			);
		}
	}

	function addClause() {
		const maxNumber = clauses.reduce((max, c) => {
			const n = parseInt(c.number);
			return isNaN(n) ? max : Math.max(max, n);
		}, 0);
		clauses = [
			...clauses,
			{ number: String(maxNumber + 1), title: 'Clauza noua', paragraphs: [''] }
		];
		// Auto-open the new clause
		const next = new Set(openSections);
		next.add(String(maxNumber + 1));
		openSections = next;
	}

	function removeClause(index: number) {
		clauses = clauses.filter((_, i) => i !== index);
	}

	function resetAllToDefault() {
		if (defaultClauses.length > 0) {
			clauses = defaultClauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs] }));
		}
	}

	function hasChanges(clause: ContractClause): boolean {
		const def = defaultClauses.find((d) => d.number === clause.number);
		if (!def) return true;
		if (def.title !== clause.title) return true;
		if (def.paragraphs.length !== clause.paragraphs.length) return true;
		return def.paragraphs.some((p, i) => p !== clause.paragraphs[i]);
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h3 class="text-lg font-semibold">Clauze legale (Sectiunile 4-23)</h3>
		<div class="flex items-center gap-2">
			<Button variant="ghost" size="sm" onclick={expandAll}>Deschide toate</Button>
			<Button variant="ghost" size="sm" onclick={collapseAll}>Inchide toate</Button>
			{#if !readonly && defaultClauses.length > 0}
				<Button variant="outline" size="sm" onclick={resetAllToDefault}>
					<RotateCcwIcon class="mr-2 h-3 w-3" />
					Reset la default
				</Button>
			{/if}
		</div>
	</div>

	{#each clauses as clause, index (clause.number)}
		{@const isOpen = openSections.has(clause.number)}
		{@const modified = !readonly && defaultClauses.length > 0 && hasChanges(clause)}
		<div class="rounded-lg border {modified ? 'border-amber-300 bg-amber-50/30 dark:border-amber-700 dark:bg-amber-950/20' : ''}">
			<button
				type="button"
				class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 rounded-lg transition-colors"
				onclick={() => toggleSection(clause.number)}
			>
				<ChevronRightIcon
					class="h-4 w-4 shrink-0 transition-transform {isOpen ? 'rotate-90' : ''}"
				/>
				<span class="text-sm font-medium">
					{clause.number}. {clause.title}
				</span>
				{#if modified}
					<span class="ml-auto text-xs text-amber-600 dark:text-amber-400">modificat</span>
				{/if}
				<span class="ml-auto text-xs text-muted-foreground">
					{clause.paragraphs.length} {clause.paragraphs.length === 1 ? 'paragraf' : 'paragrafe'}
				</span>
			</button>
			{#if isOpen}
				<div class="border-t px-4 py-4 space-y-4">
					{#if !readonly}
						<div class="space-y-1.5">
							<Label class="text-xs text-muted-foreground">Titlu sectiune</Label>
							<Input
								value={clause.title}
								oninput={(e) => updateClauseTitle(index, e.currentTarget.value)}
							/>
						</div>
					{/if}

					{#each clause.paragraphs as paragraph, pIndex}
						<div class="space-y-1.5">
							<div class="flex items-center justify-between">
								<Label class="text-xs text-muted-foreground">
									{clause.number}.{pIndex + 1}
								</Label>
								{#if !readonly && clause.paragraphs.length > 1}
									<Button
										variant="ghost"
										size="sm"
										class="h-6 w-6 p-0"
										onclick={() => removeParagraph(index, pIndex)}
									>
										<TrashIcon class="h-3 w-3 text-destructive" />
									</Button>
								{/if}
							</div>
							{#if readonly}
								<p class="text-sm whitespace-pre-wrap">{paragraph}</p>
							{:else}
								<Textarea
									value={paragraph}
									oninput={(e) => updateParagraph(index, pIndex, e.currentTarget.value)}
									rows={Math.max(2, Math.ceil(paragraph.length / 80))}
									class="text-sm"
								/>
							{/if}
						</div>
					{/each}

					{#if !readonly}
						<div class="flex items-center gap-2">
							<Button variant="outline" size="sm" onclick={() => addParagraph(index)}>
								<PlusIcon class="mr-1 h-3 w-3" />
								Adauga paragraf
							</Button>
							{#if defaultClauses.length > 0 && defaultClauses.find((d) => d.number === clause.number)}
								<Button variant="ghost" size="sm" onclick={() => resetClause(index)}>
									<RotateCcwIcon class="mr-1 h-3 w-3" />
									Reset sectiune
								</Button>
							{/if}
							<Button
								variant="ghost"
								size="sm"
								class="ml-auto text-destructive"
								onclick={() => removeClause(index)}
							>
								<TrashIcon class="mr-1 h-3 w-3" />
								Sterge clauza
							</Button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/each}

	{#if !readonly}
		<Button variant="outline" onclick={addClause} class="w-full">
			<PlusIcon class="mr-2 h-4 w-4" />
			Adauga clauza noua
		</Button>
	{/if}
</div>
