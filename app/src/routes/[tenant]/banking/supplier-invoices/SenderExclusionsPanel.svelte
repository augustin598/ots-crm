<script lang="ts">
	import { getGmailExclusions, updateGmailExclusions } from '$lib/remotes/supplier-invoices.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Plus, X } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { addExcludePattern, suggestedExclusionsToAdd } from '$lib/utils/gmail-search';
	import { reportError } from './gmail-tab-shared';

	interface Props {
		tenantSlug: string;
	}

	let { tenantSlug }: Props = $props();

	/**
	 * Instanța LIVE a query-ului: `.updates(...)` reîmprospătează doar interogările
	 * pe care le are efectiv afișate pagina, nu una reconstruită în comandă.
	 */
	const exclusionsQuery = getGmailExclusions();
	const patterns = $derived(exclusionsQuery.current ?? []);
	/**
	 * Cât timp lista nu e încărcată, `patterns` e goală — o salvare pornită acum ar
	 * trimite lista goală plus intrarea nouă și ar ȘTERGE excluderile existente.
	 */
	const loaded = $derived(exclusionsQuery.current !== undefined);
	const suggestions = $derived(suggestedExclusionsToAdd(patterns));

	let draft = $state('');
	let error = $state('');
	let saving = $state(false);
	const locked = $derived(saving || !loaded);

	async function persist(next: string[], confirmation: string) {
		saving = true;
		try {
			await updateGmailExclusions({ patterns: next }).updates(exclusionsQuery);
			toast.success(confirmation);
		} catch (err) {
			reportError('gmail_update_exclusions', err, 'Salvarea excluderilor a eșuat', tenantSlug);
		} finally {
			saving = false;
		}
	}

	async function addPattern(raw: string) {
		if (!loaded) return;
		const result = addExcludePattern(patterns, raw);
		if (!result.ok) {
			error = result.error;
			return;
		}
		error = '';
		draft = '';
		await persist(result.patterns, `„${raw.trim().toLowerCase()}” nu mai apare în rezultate`);
	}

	async function removePattern(pattern: string) {
		if (!loaded) return;
		error = '';
		await persist(
			patterns.filter((existing) => existing !== pattern),
			`„${pattern}” a fost scos dintre excluderi`
		);
	}

	function onSubmit(event: SubmitEvent) {
		event.preventDefault();
		void addPattern(draft);
	}
</script>

<div class="mt-4 border-t pt-4">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<Label class="text-xs" for="gmail-exclusion-input">Expeditori excluși</Label>
		<p class="text-xs text-muted-foreground">
			Emailurile de la acești expeditori nu apar în rezultate. Se salvează automat și rămân active
			și la potrivirea din „Documente lipsă”.
		</p>
	</div>

	{#if !loaded}
		<p class="mt-2 text-xs text-muted-foreground">Se încarcă excluderile…</p>
	{:else if patterns.length > 0}
		<div class="mt-2 flex flex-wrap gap-2">
			{#each patterns as pattern (pattern)}
				<span
					class="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-1 pr-1 pl-3 text-xs"
				>
					{pattern}
					<button
						type="button"
						class="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
						disabled={locked}
						aria-label="Elimină excluderea {pattern}"
						onclick={() => removePattern(pattern)}
					>
						<X class="h-3 w-3" />
					</button>
				</span>
			{/each}
		</div>
	{:else}
		<p class="mt-2 text-xs text-muted-foreground">
			Nicio excludere — căutarea acoperă toți expeditorii din interval.
		</p>
	{/if}

	<form class="mt-3 flex flex-wrap items-start gap-2" onsubmit={onSubmit}>
		<div class="min-w-[220px] flex-1">
			<Input
				id="gmail-exclusion-input"
				placeholder="tiktok.com, @furnizor.ro sau facturi@furnizor.ro — câte unul pe rând"
				bind:value={draft}
				disabled={locked}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? 'gmail-exclusion-error' : undefined}
				oninput={() => (error = '')}
			/>
		</div>
		<Button type="submit" variant="outline" size="sm" disabled={locked || !draft.trim()}>
			<Plus class="mr-2 h-4 w-4" />
			Adaugă
		</Button>
	</form>

	{#if error}
		<p id="gmail-exclusion-error" class="mt-2 text-sm text-destructive">{error}</p>
	{/if}

	{#if loaded && suggestions.length > 0}
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<span class="text-xs text-muted-foreground">Sugestii:</span>
			{#each suggestions as suggestion (suggestion)}
				<Button
					variant="ghost"
					size="sm"
					class="h-7 px-2 text-xs"
					disabled={locked}
					onclick={() => addPattern(suggestion)}
				>
					+ {suggestion}
				</Button>
			{/each}
		</div>
	{/if}
</div>
