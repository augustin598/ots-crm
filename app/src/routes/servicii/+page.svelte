<!--
	`/servicii` — pagină publică, dar privată: oricine o poate deschide, conținutul
	apare doar după parola primită de la echipa OTS.

	Când vizitatorul n-a deblocat pagina, `data.catalog` nici nu există — serverul
	nu-l trimite. Componentele publice primesc catalogul prin props și nu importă
	niciodată `$lib/constants/ots-catalog`, deci prețurile nu apar nici în HTML,
	nici în vreun chunk JS accesibil fără parolă.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { Input } from '$lib/components/ui/input';
	import GateShell from '$lib/components/brand/GateShell.svelte';
	import LockIcon from '@lucide/svelte/icons/lock-keyhole';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ServicesCatalog from './ServicesCatalog.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	let showPassword = $state(false);
</script>

<svelte:head>
	<title>Servicii & Pachete · One Top Solution</title>
	<!-- Pagină cu acces pe bază de parolă: nu vrem să ajungă în indexul motoarelor. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if data.unlocked}
	<ServicesCatalog catalog={data.catalog} company={data.company} />
{:else}
	<GateShell>
		<div class="ots-gate-card">
			<div class="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 mb-5">
				<LockIcon class="h-5 w-5 text-primary" />
			</div>

			<h1 class="text-2xl font-bold tracking-tight">Servicii & Pachete</h1>
			<p class="text-sm text-muted-foreground mt-2">
				Catalogul cu toate serviciile și prețurile pe pachete e deschis doar cu parolă. Introdu-o
				mai jos ca să-l vezi.
			</p>

			<form
				method="POST"
				action="?/unlock"
				class="mt-6 grid gap-4"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				<div class="relative">
					<Input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						required
						maxlength={255}
						autocomplete="current-password"
						autofocus
						placeholder="Parolă"
						aria-label="Parolă"
						class="h-11 pr-11"
						aria-invalid={form?.message ? 'true' : undefined}
					/>
					<button
						type="button"
						class="ots-eye"
						onclick={() => (showPassword = !showPassword)}
						aria-label={showPassword ? 'Ascunde parola' : 'Arată parola'}
						aria-pressed={showPassword}
						title={showPassword ? 'Ascunde parola' : 'Arată parola'}
					>
						{#if showPassword}
							<EyeOffIcon class="h-4 w-4" />
						{:else}
							<EyeIcon class="h-4 w-4" />
						{/if}
					</button>
				</div>

				{#if form?.message}
					<p class="text-sm text-destructive" role="alert">{form.message}</p>
				{/if}

				<button type="submit" class="ots-gate-btn ots-gloss" disabled={submitting}>
					{submitting ? 'Se verifică...' : 'Intră'}
					<ArrowRightIcon class="h-4 w-4" />
				</button>
			</form>
		</div>

		{#snippet footer()}
			<p class="text-center text-xs text-muted-foreground mt-6">
				N-ai parola? Scrie-ne și ți-o trimitem.
			</p>
		{/snippet}
	</GateShell>
{/if}
