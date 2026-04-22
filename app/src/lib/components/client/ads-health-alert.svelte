<script lang="ts">
	import { getClientAdsHealth } from '$lib/remotes/ads-status.remote';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import AlertOctagonIcon from '@lucide/svelte/icons/alert-octagon';
	import * as Tooltip from '$lib/components/ui/tooltip';

	interface Props {
		clientId: string;
	}

	const { clientId }: Props = $props();

	const healthQuery = $derived(clientId ? getClientAdsHealth({ clientId }) : null);
	const data = $derived(healthQuery?.current);
	const flagged = $derived(data?.flagged ?? []);

	// Severity: has a critical status in the list → critical banner styling
	const hasCritical = $derived(
		flagged.some((f) => f.paymentStatus === 'suspended' || f.paymentStatus === 'payment_failed'),
	);

	// Header balance pill: shown at the top-right of the alert card when
	// there's a known outstanding balance. Single flagged account → show its
	// balance; multiple → show count of accounts with balance to avoid
	// misleading aggregation across currencies.
	const headerBalance = $derived.by(() => {
		const withBalance = flagged.filter((f) => f.balanceFormatted);
		if (withBalance.length === 0) return null;
		if (withBalance.length === 1) {
			return { text: withBalance[0].balanceFormatted!, status: withBalance[0].paymentStatus };
		}
		return { text: `${withBalance.length} conturi cu sold`, status: 'payment_failed' };
	});

	// Single severity dot color — used as a small indicator beside text.
	const severityDot = $derived(hasCritical ? '#ef4444' : '#f59e0b');

	function iconFor(provider: string) {
		switch (provider) {
			case 'meta':
				return IconFacebook;
			case 'google':
				return IconGoogleAds;
			case 'tiktok':
				return IconTiktok;
			default:
				return null;
		}
	}

	function formatTimestamp(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return d.toLocaleString('ro-RO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	/** Explicit window.open avoids some popup blocker edge cases where
	 * anchor + target=_blank silently fails inside iframed/embedded contexts. */
	function openLink(url: string) {
		window.open(url, '_blank', 'noopener,noreferrer');
	}

	/** CTA button color matches status severity so clients can see urgency at a glance. */
	function ctaColorFor(status: string): string {
		switch (status) {
			case 'suspended':
				return '#7f1d1d'; // dark red — terminal action
			case 'payment_failed':
				return '#dc2626'; // red — urgent pay
			case 'grace_period':
				return '#d97706'; // amber — pay soon
			case 'risk_review':
				return '#b45309'; // deep amber — verify
			default:
				return '#475569';
		}
	}

	/**
	 * Tooltip copy per status — mirrors the in-platform messaging clients see
	 * on Facebook/Google/TikTok so they understand what to do next.
	 */
	function tooltipFor(status: string, reason: string | null = null): { title: string; body: string } {
		// TikTok sub-reasons layered on risk_review — account is STATUS_ENABLE
		// but campaigns aren't actually delivering (budget exhausted, rejected).
		if (status === 'risk_review' && reason === 'budget_exceeded') {
			return {
				title: 'Buget campanii consumat',
				body:
					'Campaniile tale au atins limita de buget setată în TikTok. Crește bugetul sau așteaptă reset-ul zilnic pentru ca reclamele să reînceapă livrarea.',
			};
		}
		if (status === 'risk_review' && reason === 'no_delivery') {
			return {
				title: 'Reclame oprite',
				body:
					'Contul este activ, dar nicio campanie nu livrează acum (respinsă la verificare, în afara programului sau oprită din altă cauză). Verifică campaniile în TikTok Ads Manager.',
			};
		}
		switch (status) {
			case 'grace_period':
				return {
					title: 'Factură neachitată — perioadă de grație',
					body:
						'Reclamele încă rulează, dar vor fi oprite automat dacă nu achiți soldul în zilele următoare. Apasă Plătește pentru a actualiza balanța.',
				};
			case 'payment_failed':
				return {
					title: 'Plata a eșuat',
					body:
						'Reclamele sunt oprite până când soldul este achitat sau metoda de plată actualizată. Apasă Plătește pentru a le reactiva.',
				};
			case 'risk_review':
				return {
					title: 'Cont în curs de verificare',
					body:
						'Platforma verifică contul. Livrarea reclamelor poate fi limitată temporar. Deschide setările contului pentru a vedea ce acțiuni sunt necesare.',
				};
			case 'suspended':
				return {
					title: 'Cont suspendat',
					body:
						'Platforma a suspendat acest cont și reclamele nu mai rulează. Deschide setările pentru detalii sau contactează suportul platformei.',
				};
			case 'closed':
				return {
					title: 'Cont închis',
					body:
						'Contul este închis definitiv. Contactează suportul platformei dacă este o eroare.',
				};
			default:
				return { title: '', body: '' };
		}
	}
</script>

{#if flagged.length > 0}
	<div
		class="overflow-hidden rounded-xl border border-zinc-200 border-l-4 bg-white shadow-sm"
		class:border-l-red-500={hasCritical}
		class:border-l-amber-500={!hasCritical}
	>
		<!-- Header with subtle tint to draw attention -->
		<div
			class="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4"
			class:bg-red-50={hasCritical}
			class:bg-amber-50={!hasCritical}
		>
			<div class="flex min-w-0 items-center gap-2.5">
				<span class="relative flex size-4 shrink-0 items-center justify-center">
					<span
						class="absolute inline-flex size-full animate-ping rounded-full opacity-40"
						style="background: {severityDot};"
					></span>
					{#if hasCritical}
						<AlertOctagonIcon class="relative size-4" style="color: {severityDot};" />
					{:else}
						<AlertTriangleIcon class="relative size-4" style="color: {severityDot};" />
					{/if}
				</span>
				<h3 class="truncate text-sm font-semibold text-zinc-900">
					Atenție · conturi publicitate cu probleme
				</h3>
			</div>
			{#if headerBalance}
				<div class="hidden shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 shadow-sm md:inline-flex">
					<span class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
						Sold restant
					</span>
					<span class="text-sm font-semibold tabular-nums text-zinc-900">
						{headerBalance.text}
					</span>
				</div>
			{/if}
		</div>

		<!-- Account list -->
		<ul class="divide-y divide-zinc-100">
			{#each flagged as item (item.provider + ':' + item.externalAccountId)}
				{@const Icon = iconFor(item.provider)}
				{@const tip = tooltipFor(item.paymentStatus, item.rawDisableReason)}
				<li class="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50/60">
					<div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50">
						{#if Icon}
							<Icon class="size-4" />
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-medium text-zinc-900">
							{item.accountName}
						</div>
						<div class="truncate text-xs text-zinc-500">
							{item.providerLabel} · <code class="font-mono">{item.externalAccountId}</code>
						</div>
					</div>
					<Tooltip.Root>
						<Tooltip.Trigger>
							<span class="inline-flex shrink-0 cursor-help items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
								<span
									class="size-1.5 rounded-full"
									style="background: {ctaColorFor(item.paymentStatus)};"
								></span>
								{item.statusLabel}
							</span>
						</Tooltip.Trigger>
						<Tooltip.Content
							side="top"
							class="max-w-xs rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-lg"
						>
							<p class="mb-1 text-xs font-semibold text-zinc-900">{tip.title}</p>
							{#if item.balanceFormatted}
								<p class="mb-2 text-xs font-semibold tabular-nums text-zinc-900">
									Sold restant: {item.balanceFormatted}
								</p>
							{/if}
							<p class="text-xs leading-relaxed text-zinc-600">{tip.body}</p>
						</Tooltip.Content>
					</Tooltip.Root>
					{#if item.action}
						<button
							type="button"
							onclick={() => openLink(item.action!.url)}
							class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
						>
							{item.action.label}
							<ArrowRightIcon class="size-3" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>

		<!-- Footer timestamp -->
		<div class="flex items-center gap-1.5 border-t border-zinc-100 bg-zinc-50/50 px-5 py-2.5 text-xs text-zinc-500">
			<ClockIcon class="size-3" />
			<span>
				Verificare automată orară · Ultima verificare {formatTimestamp(data?.lastCheckedAt ?? null)}
			</span>
		</div>
	</div>
{/if}
