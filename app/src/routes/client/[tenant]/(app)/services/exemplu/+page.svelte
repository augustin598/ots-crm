<!--
  Wizardul din portalul clientului. Toată logica și interfața stau în
  `PackageWizard.svelte`, partajat cu pagina publică `/servicii/configurator` —
  o schimbare de întrebări sau de scorare se face într-un singur loc.

  Ce rămâne specific portalului: catalogul vine din constante (pagina e deja în
  spatele autentificării, deci nu contează că ajunge în bundle), iar cererea se
  trimite pe contul clientului logat.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import PackageWizard from '$lib/components/services/PackageWizard.svelte';
	import { createPackageRequest } from '$lib/remotes/packages.remote';
	import type { Recommendation } from '$lib/logic/wizard-engine';
	import {
		CATEGORIES,
		BUNDLES,
		BUNDLE_TIERS_RULE,
		TIER_LABELS,
		TIER_COLORS
	} from '$lib/constants/ots-catalog';

	const tenantSlug = $derived(page.params.tenant);

	const catalog = {
		categories: CATEGORIES,
		bundles: BUNDLES,
		bundleTiersRule: BUNDLE_TIERS_RULE,
		tierLabels: TIER_LABELS,
		tierColors: TIER_COLORS
	};

	async function handleRequest(rec: Recommendation, note: string) {
		// O singură cerere per bundle — backend stochează `bundleId` + lista `services`.
		await createPackageRequest({
			categorySlug: rec.bundle.services[0], // primul serviciu ca pivot pentru compat
			bundleId: rec.bundle.id,
			services: rec.bundle.services,
			tier: rec.tier,
			note
		});
		toast.success('Cererea a fost trimisă cu succes', {
			description: 'Echipa OTS te contactează cu oferta finală consolidată.'
		});
		goto(`/client/${tenantSlug}/services`);
	}
</script>

<svelte:head>
	<title>Ce pachet aleg? — Wizard OTS</title>
</svelte:head>

<PackageWizard {catalog} backHref={`/client/${tenantSlug}/services`} onRequest={handleRequest} />
