<!--
  Wizardul public. Aceeași componentă ca în portalul clientului
  (`$lib/components/services/PackageWizard.svelte`) — diferă doar de unde vine
  catalogul și cum pleacă cererea.

  Vizitatorul nu are cont, deci recomandarea nu se poate trimite direct: la
  „Cere ofertă" deschidem formularul public de contact, cu nota wizardului
  preîncărcată.
-->
<script lang="ts">
	import PackageWizard from '$lib/components/services/PackageWizard.svelte';
	import RequestQuoteDialog from '../RequestQuoteDialog.svelte';
	import type { Recommendation } from '$lib/logic/wizard-engine';
	import type { Category } from '$lib/constants/ots-catalog';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const catalog = $derived({
		categories: data.catalog.categories,
		bundles: data.catalog.bundles,
		bundleTiersRule: data.catalog.discountRules,
		tierLabels: data.catalog.tierLabels,
		tierColors: data.catalog.tierColors
	});

	let quoteOpen = $state(false);
	let quoteCategory = $state<Category | null>(null);
	let quoteTier = $state<Recommendation['tier'] | null>(null);
	let quoteNote = $state('');
	// Contorul remontează dialogul la fiecare cerere, ca a doua să nu pornească
	// din ecranul de confirmare al primeia (același motiv ca în ServicesCatalog).
	let quoteSeq = $state(0);

	async function handleRequest(rec: Recommendation, note: string) {
		// Backendul public acceptă un singur `categorySlug`; trimitem primul
		// serviciu ca pivot, iar componența completă a bundle-ului stă în notă.
		const pivot = data.catalog.categories.find((c) => c.slug === rec.bundle.services[0]);
		if (!pivot) return;

		const services = rec.bundle.services
			.map((s) => data.catalog.categories.find((c) => c.slug === s)?.name ?? s)
			.join(', ');

		quoteCategory = pivot;
		quoteTier = rec.tier;
		quoteNote = `${note}\n\nServicii în pachet: ${services}`;
		quoteSeq += 1;
		quoteOpen = true;
	}
</script>

<svelte:head>
	<title>Ce pachet aleg? — One Top Solution</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<PackageWizard {catalog} backHref="/servicii" onRequest={handleRequest} />

{#key quoteSeq}
	<RequestQuoteDialog
		bind:open={quoteOpen}
		category={quoteCategory}
		tier={quoteTier}
		tierLabels={data.catalog.tierLabels}
		tierColors={data.catalog.tierColors}
		bind:note={quoteNote}
	/>
{/key}
