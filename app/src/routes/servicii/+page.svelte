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
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import LockIcon from '@lucide/svelte/icons/lock-keyhole';
	import ServicesCatalog from './ServicesCatalog.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>Servicii & Pachete · One Top Solution</title>
	<!-- Pagină cu acces pe bază de parolă: nu vrem să ajungă în indexul motoarelor. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if data.unlocked}
	<ServicesCatalog catalog={data.catalog} company={data.company} />
{:else}
	<div class="min-h-screen bg-muted/30 flex items-center justify-center px-4 py-12">
		<div class="w-full max-w-md">
			<div class="flex justify-center mb-8">
				<img src="/onetop-logo.png" alt="One Top Solution" class="h-10 w-auto" />
			</div>

			<div class="rounded-2xl border bg-card shadow-sm p-8">
				<div class="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 mb-5">
					<LockIcon class="h-5 w-5 text-primary" />
				</div>

				<h1 class="text-2xl font-bold tracking-tight">Servicii & Pachete</h1>
				<p class="text-sm text-muted-foreground mt-2">
					Pagina e privată. Introdu parola primită de la echipa One Top Solution ca să vezi
					catalogul complet, cu prețuri pe pachete.
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
					<div class="grid gap-2">
						<Label for="password">Parolă</Label>
						<Input
							id="password"
							name="password"
							type="password"
							required
							maxlength={255}
							autocomplete="current-password"
							autofocus
							aria-invalid={form?.message ? 'true' : undefined}
						/>
					</div>

					{#if form?.message}
						<p class="text-sm text-destructive" role="alert">{form.message}</p>
					{/if}

					<Button type="submit" class="w-full" disabled={submitting}>
						{submitting ? 'Se verifică...' : 'Intră'}
					</Button>
				</form>
			</div>

			<p class="text-center text-xs text-muted-foreground mt-6">
				N-ai parola? Scrie-ne și ți-o trimitem.
			</p>
		</div>
	</div>
{/if}
