<!--
  Wizardul public. Aceeași componentă ca în portalul clientului
  (`$lib/components/services/PackageWizard.svelte`) — diferă doar de unde vine
  catalogul și cum pleacă cererea.

  Vizitatorul nu are cont, deci recomandarea nu se trimite direct: serviciile
  bundle-ului intră în coșul paginii /servicii (la tier-ul recomandat) și se
  deschide modalul de ofertă, cu nota wizardului preîncărcată. Coșul e partajat
  prin sessionStorage, deci întoarcerea la catalog arată aceleași servicii.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import PackageWizard from '$lib/components/services/PackageWizard.svelte';
	import ServicesQuoteModal from '../ServicesQuoteModal.svelte';
	import { ServicesCart } from '../services-cart.svelte';
	import type { Recommendation } from '$lib/logic/wizard-engine';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const catalog = $derived({
		categories: data.catalog.categories,
		bundles: data.catalog.bundles,
		bundleTiersRule: data.catalog.discountRules,
		tierLabels: data.catalog.tierLabels,
		tierColors: data.catalog.tierColors
	});

	const cart = new ServicesCart();
	const validSlugs = $derived(new Set(data.catalog.categories.map((c) => c.slug)));
	onMount(() => {
		cart.load(
			(slug, tier) => validSlugs.has(slug) && (data.catalog.tiers as string[]).includes(tier)
		);
	});

	let quoteOpen = $state(false);
	let quoteNote = $state('');

	async function handleRequest(rec: Recommendation, note: string) {
		// Recomandarea înlocuiește coșul: vizitatorul a cerut explicit acest bundle.
		cart.clear();
		for (const slug of rec.bundle.services) {
			if (validSlugs.has(slug)) cart.set(slug, rec.tier);
		}
		quoteNote = note;
		quoteOpen = true;
	}
</script>

<svelte:head>
	<title>Ce pachet aleg? — One Top Solution</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<PackageWizard {catalog} backHref="/servicii" onRequest={handleRequest} />

{#if quoteOpen}
	<ServicesQuoteModal
		{cart}
		catalog={data.catalog}
		initialNote={quoteNote}
		onClose={() => (quoteOpen = false)}
	/>
{/if}
