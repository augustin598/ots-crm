<script lang="ts">
	import { getClientAdsHealth } from '$lib/remotes/ads-status.remote';
	import { describeStatus, isCriticalStatus } from '$lib/ads/status-copy';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import AlertOctagonIcon from '@lucide/svelte/icons/alert-octagon';

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
				{@const details = describeStatus({
					provider: item.provider,
					paymentStatus: item.paymentStatus,
					rawDisableReason: item.rawDisableReason,
					rejectReasonMessage: item.rejectReasonMessage,
					rejectReasonEndsAt: item.rejectReasonEndsAt,
				})}
				{@const isCritical = isCriticalStatus(item.paymentStatus)}
				<li class="flex flex-col gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50/60">
					<div class="flex items-center gap-3">
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
						<span class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
							<span
								class="size-1.5 rounded-full"
								style="background: {ctaColorFor(item.paymentStatus)};"
							></span>
							{item.statusLabel}
						</span>
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
					</div>
					{#if details}
						<div
							class="rounded-lg border p-3 sm:ml-12"
							class:border-red-200={isCritical}
							class:bg-red-50={isCritical}
							class:border-amber-200={!isCritical}
							class:bg-amber-50={!isCritical}
						>
							<p
								class="text-xs font-semibold"
								class:text-red-900={isCritical}
								class:text-amber-900={!isCritical}
							>
								{details.headline}
							</p>
							<p
								class="mt-0.5 text-xs leading-relaxed"
								class:text-red-800={isCritical}
								class:text-amber-800={!isCritical}
							>
								{details.body}
							</p>
							{#if item.balanceFormatted}
								<p
									class="mt-1.5 text-xs font-semibold tabular-nums"
									class:text-red-900={isCritical}
									class:text-amber-900={!isCritical}
								>
									Sold restant: {item.balanceFormatted}
								</p>
							{/if}
							{#if details.deadline}
								<p
									class="mt-1.5 text-xs font-medium"
									class:text-red-900={isCritical}
									class:text-amber-900={!isCritical}
								>
									Termen expirare: {details.deadline}
								</p>
							{/if}
							<p
								class="mt-2 flex items-start gap-1.5 text-xs font-medium"
								class:text-red-900={isCritical}
								class:text-amber-900={!isCritical}
							>
								<span aria-hidden="true">💡</span>
								<span>{details.suggestion}</span>
							</p>
						</div>
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
