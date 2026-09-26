<script lang="ts">
	/**
	 * Portal → Hosting → Pachete: aceleași carduri și același checkout ca pe
	 * /pachete-hosting. Clientul e deja logat, deci checkout-ul sare peste pasul de
	 * cont și leagă comanda de contul lui (vezi HostingCheckoutModal.portalClient).
	 */
	import { getPublicHostingPackages } from '$lib/remotes/public-hosting.remote';
	import { resolveVatPercent } from '$lib/utils/vat';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import HostingPlanCards, {
		type HostingPlanCard
	} from '$lib/components/hosting/hosting-plan-cards.svelte';
	import HostingBillingToggle from '$lib/components/hosting/hosting-billing-toggle.svelte';
	import HostingCheckoutModal from '$lib/components/hosting-checkout-modal.svelte';
	import type { PortalClientSummary } from '$lib/components/checkout/portal-client';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

	const tenantSlug = $derived(page.params.tenant ?? '');
	const layoutData = $derived(page.data as Record<string, any>);

	// Pachetele publice (cele comandabile online) — aceeași sursă ca pagina publică.
	const packagesQuery = getPublicHostingPackages();
	const packages = $derived((packagesQuery.current?.packages ?? []) as HostingPlanCard[]);
	const vatRate = $derived(resolveVatPercent(packagesQuery.current?.vatRate));
	const tenantInfo = $derived(packagesQuery.current?.tenantInfo ?? null);
	const publishableKey = $derived(packagesQuery.current?.publishableKey ?? null);
	const loading = $derived(packagesQuery.loading && !packagesQuery.current);
	// Checkout-ul public comandă pe tenantul site-ului public; în alt tenant nu avem comandă online.
	const canOrderOnline = $derived(
		!packagesQuery.current || packagesQuery.current.tenantSlug === tenantSlug
	);

	let yearly = $state(true);
	let checkoutPkg = $state<HostingPlanCard | null>(null);

	// Clientul activ din portal → checkout fără pas de cont, facturare precompletată.
	const portalClient = $derived.by<PortalClientSummary | null>(() => {
		const c = layoutData.client;
		if (!c) return null;
		return {
			id: c.id,
			name: c.name,
			email: c.email ?? null,
			isPrimary: layoutData.isClientUserPrimary ?? false,
			billing: {
				businessName: c.businessName ?? null,
				legalType: c.legalType ?? null,
				cui: c.cui ?? null,
				vatNumber: c.vatNumber ?? null,
				registrationNumber: c.registrationNumber ?? null,
				phone: c.phone ?? null,
				address: c.address ?? null,
				city: c.city ?? null,
				county: c.county ?? null,
				postalCode: c.postalCode ?? null
			}
		};
	});

	function order(pkg: HostingPlanCard) {
		if (!canOrderOnline) {
			toast.info('Pentru acest pachet scrie-ne la office@onetopsolution.ro și îl activăm noi.');
			return;
		}
		checkoutPkg = pkg;
	}
</script>

<div class="pp-page">
	<Button variant="ghost" size="sm" href="/client/{tenantSlug}/hosting">
		<ArrowLeftIcon class="h-4 w-4" />
		Conturile mele
	</Button>

	<header class="pp-head">
		<h1 class="pp-title">Pachete hosting</h1>
		<p class="pp-sub">
			Hosting administrat pe servere NVMe, cu SSL, backup zilnic și suport în limba română.
		</p>
		<div class="pp-toggle">
			<HostingBillingToggle bind:yearly />
		</div>
	</header>

	<HostingPlanCards {packages} {loading} {yearly} onOrder={order}>
		{#snippet empty()}
			Nu există pachete disponibile momentan. Scrie-ne la
			<a href="mailto:office@onetopsolution.ro">office@onetopsolution.ro</a>.
		{/snippet}
	</HostingPlanCards>

	{#if !loading && packages.length > 0}
		<p class="pp-foot">
			Toate prețurile sunt afișate <strong>fără TVA</strong>; TVA {vatRate}% se adaugă la checkout.
			Ai nevoie de mai mult? Scrie-ne la
			<a href="mailto:office@onetopsolution.ro">office@onetopsolution.ro</a>.
		</p>
	{/if}
</div>

{#if checkoutPkg}
	<HostingCheckoutModal
		plan={{
			id: checkoutPkg.id,
			name: checkoutPkg.name,
			currency: checkoutPkg.currency,
			billingCycle: checkoutPkg.billingCycle
		}}
		period={yearly ? 'yearly' : 'monthly'}
		{vatRate}
		priceCents={checkoutPkg.price}
		bankInfo={{
			name: tenantInfo?.name ?? null,
			bankName: tenantInfo?.bankName ?? null,
			iban: tenantInfo?.iban ?? null,
			ibanEuro: tenantInfo?.ibanEuro ?? null,
			cui: tenantInfo?.cui ?? null,
			vatNumber: tenantInfo?.vatNumber ?? null,
			phone: tenantInfo?.phone ?? null,
			email: tenantInfo?.email ?? null
		}}
		preloadedPublishableKey={publishableKey}
		portalClient={portalClient?.isPrimary ? portalClient : null}
		portalTenantSlug={tenantSlug}
		onClose={() => (checkoutPkg = null)}
	/>
{/if}

<style>
	.pp-page {
		display: flex;
		flex-direction: column;
		gap: 24px;
		align-items: stretch;
	}
	.pp-page > :global(:first-child) {
		align-self: flex-start;
	}
	.pp-head {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.pp-title {
		margin: 0;
		font-size: 28px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.pp-sub {
		margin: 0;
		max-width: 560px;
		font-size: 14px;
		color: var(--muted-foreground);
	}
	.pp-toggle {
		margin-top: 12px;
	}
	.pp-foot {
		margin: 0;
		text-align: center;
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.pp-foot a,
	.pp-page :global(.hp-empty a) {
		color: var(--primary);
		font-weight: 600;
		text-decoration: underline;
	}
</style>
