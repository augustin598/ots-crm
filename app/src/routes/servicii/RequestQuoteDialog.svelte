<!--
	Formularul public „Cere ofertă" de pe /servicii.

	Vizitatorul nu are cont, deci colectăm datele de contact aici. Cererea intră
	în CRM cu `source = 'public'` și apare în /ots/services → tab „Cereri clienți",
	iar owner/admin primesc email.
-->
<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check-big';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import { formatEur } from '$lib/constants/ots-catalog-format';
	import type { Category, Tier, TierColors } from '$lib/constants/ots-catalog';
	import { submitPublicPackageRequest } from '$lib/remotes/public-services.remote';

	type Props = {
		open: boolean;
		category: Category | null;
		tier: Tier | null;
		tierLabels: Record<Tier, string>;
		tierColors: Record<Tier, TierColors>;
	};

	let { open = $bindable(), category, tier, tierLabels, tierColors }: Props = $props();

	let contactName = $state('');
	let contactEmail = $state('');
	let contactPhone = $state('');
	let companyName = $state('');
	let note = $state('');

	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let sent = $state(false);

	// Starea de mai sus e per-instanță: părintele montează un dialog nou la fiecare
	// „Cere ofertă" (vezi {#key} din ServicesCatalog), deci a doua cerere nu
	// pornește niciodată din ecranul de confirmare al primei.

	function close() {
		open = false;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!category || !tier || submitting) return;

		submitting = true;
		errorMessage = null;
		try {
			await submitPublicPackageRequest({
				categorySlug: category.slug,
				tier,
				contactName: contactName.trim(),
				contactEmail: contactEmail.trim(),
				contactPhone: contactPhone.trim() || undefined,
				companyName: companyName.trim() || undefined,
				note: note.trim() || undefined
			});
			sent = true;
			note = '';
		} catch (err) {
			errorMessage =
				err instanceof Error && err.message
					? err.message
					: 'Nu am putut trimite cererea. Te rugăm să încerci din nou.';
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-[520px]">
		{#if category && tier}
			{@const price = category.prices[tier]}
			{@const setup = category.setupFees?.[tier]}
			{@const colors = tierColors[tier]}

			{#if sent}
				<DialogHeader>
					<DialogTitle>Cerere trimisă</DialogTitle>
					<DialogDescription>Îți mulțumim — revenim cu un răspuns.</DialogDescription>
				</DialogHeader>
				<div class="flex flex-col items-center text-center gap-3 py-6">
					<CheckCircleIcon class="h-12 w-12 text-green-600" />
					<p class="text-sm text-muted-foreground max-w-[380px]">
						Am înregistrat cererea pentru <strong>{category.name} — {tierLabels[tier]}</strong>.
						Echipa OTS te contactează pe <strong>{contactEmail}</strong> în cel mai scurt timp.
					</p>
				</div>
				<DialogFooter>
					<Button onclick={close}>Închide</Button>
				</DialogFooter>
			{:else}
				<DialogHeader>
					<div class="flex items-center gap-3">
						<div class="rounded-lg bg-muted/60 p-2.5 shrink-0">
							<CategoryIcon slug={category.slug} class="h-5 w-5" />
						</div>
						<div class="min-w-0">
							<DialogTitle>Cere ofertă — {tierLabels[tier]}</DialogTitle>
							<DialogDescription>{category.name} — {category.tagline}</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				<div class="rounded-lg border {colors.border} {colors.bg} px-4 py-3 my-4">
					<div class="flex items-center justify-between gap-3">
						<span class="inline-flex items-center gap-2 text-sm font-semibold {colors.text}">
							<span class="h-2.5 w-2.5 rounded-full {colors.dot}"></span>
							{tierLabels[tier]}
						</span>
						<span class="text-lg font-bold {colors.text}">
							{#if price !== null}
								{formatEur(price)}<span class="text-xs font-normal opacity-70">/lună</span>
							{:else if setup}
								{formatEur(setup)}<span class="text-xs font-normal opacity-70">one-time</span>
							{/if}
						</span>
					</div>
					{#if setup && price !== null}
						<p class="text-xs text-muted-foreground mt-1">
							Setup one-time: <strong>{formatEur(setup)}</strong>
						</p>
					{/if}
				</div>

				<form onsubmit={handleSubmit} class="grid gap-4">
					<div class="grid gap-2">
						<Label for="q-name">Nume și prenume *</Label>
						<Input id="q-name" bind:value={contactName} required maxlength={120} autocomplete="name" />
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-2">
							<Label for="q-email">Email *</Label>
							<Input
								id="q-email"
								type="email"
								bind:value={contactEmail}
								required
								maxlength={255}
								autocomplete="email"
							/>
						</div>
						<div class="grid gap-2">
							<Label for="q-phone">Telefon</Label>
							<Input id="q-phone" bind:value={contactPhone} maxlength={40} autocomplete="tel" />
						</div>
					</div>
					<div class="grid gap-2">
						<Label for="q-company">Companie</Label>
						<Input
							id="q-company"
							bind:value={companyName}
							maxlength={160}
							autocomplete="organization"
						/>
					</div>
					<div class="grid gap-2">
						<Label for="q-note">Detalii despre proiect</Label>
						<Textarea
							id="q-note"
							bind:value={note}
							rows={4}
							maxlength={2000}
							placeholder="Industrie, obiective, buget media estimat, dată de start..."
						/>
					</div>

					{#if errorMessage}
						<p class="text-sm text-destructive" role="alert">{errorMessage}</p>
					{/if}

					<p class="text-xs text-muted-foreground">
						Trimițând cererea ești de acord să te contactăm pe datele de mai sus. Nu le folosim
						pentru altceva.
					</p>

					<DialogFooter>
						<Button type="button" variant="outline" onclick={close} disabled={submitting}>
							Anulează
						</Button>
						<Button type="submit" disabled={submitting}>
							{submitting ? 'Se trimite...' : 'Trimite cererea'}
						</Button>
					</DialogFooter>
				</form>
			{/if}
		{/if}
	</DialogContent>
</Dialog>
