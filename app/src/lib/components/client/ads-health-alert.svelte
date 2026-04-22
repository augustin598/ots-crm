<script lang="ts">
	import { getClientAdsHealth } from '$lib/remotes/ads-status.remote';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import AlertOctagonIcon from '@lucide/svelte/icons/alert-octagon';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ClockIcon from '@lucide/svelte/icons/clock';
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

	// Banner-level accent color
	const accent = $derived(hasCritical ? '#dc2626' : '#d97706');
	const accentBg = $derived(hasCritical ? '#fef2f2' : '#fefce8');
	const accentBorder = $derived(hasCritical ? 'border-red-500' : 'border-amber-500');

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

	function badgeClassFor(status: string): string {
		switch (status) {
			case 'suspended':
			case 'payment_failed':
				return 'bg-red-100 text-red-800 border-red-200';
			case 'grace_period':
				return 'bg-yellow-100 text-yellow-800 border-yellow-200';
			case 'risk_review':
				return 'bg-amber-100 text-amber-800 border-amber-200';
			case 'closed':
				return 'bg-zinc-200 text-zinc-800 border-zinc-300';
			default:
				return 'bg-zinc-100 text-zinc-700 border-zinc-200';
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
	function tooltipFor(status: string): { title: string; body: string } {
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
		class="relative overflow-hidden rounded-xl border-l-4 shadow-sm {accentBorder}"
		style="background: {accentBg};"
	>
		<!-- Decorative gradient overlay -->
		<div
			class="pointer-events-none absolute inset-0 opacity-30"
			style="background: radial-gradient(circle at top right, {accent}15, transparent 60%);"
		></div>

		<div class="relative p-5 md:p-6">
			<!-- Header -->
			<div class="mb-4 flex items-start gap-3">
				<div class="shrink-0 rounded-full p-2" style="background: {accent}20;">
					{#if hasCritical}
						<AlertOctagonIcon class="size-5" style="color: {accent};" />
					{:else}
						<AlertTriangleIcon class="size-5" style="color: {accent};" />
					{/if}
				</div>
				<div class="flex-1">
					<h3 class="text-sm font-bold uppercase tracking-wide" style="color: {accent};">
						Atenție — conturi publicitate cu probleme
					</h3>
					<p class="mt-1 text-base font-semibold text-zinc-900">
						{flagged.length}
						{flagged.length === 1 ? 'cont necesită' : 'conturi necesită'} atenția ta
					</p>
				</div>
			</div>

			<!-- Account list -->
			<ul class="divide-y divide-zinc-200/70 overflow-hidden rounded-lg bg-white/70 backdrop-blur-sm">
				{#each flagged as item (item.provider + ':' + item.externalAccountId)}
					{@const Icon = iconFor(item.provider)}
					{@const tip = tooltipFor(item.paymentStatus)}
					<li class="flex items-center gap-3 p-3 transition-colors hover:bg-white">
						<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-50">
							{#if Icon}
								<Icon class="size-4" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-semibold text-zinc-900">
								{item.accountName}
							</div>
							<div class="truncate text-xs text-zinc-500">
								{item.providerLabel} · <code class="font-mono">{item.externalAccountId}</code>
							</div>
						</div>
						{#if item.balanceFormatted}
							<div class="hidden shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 shadow-sm md:inline-flex">
								<span class="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
									Sold
								</span>
								<span
									class="text-sm font-bold tabular-nums"
									style="color: {ctaColorFor(item.paymentStatus)};"
								>
									{item.balanceFormatted}
								</span>
							</div>
						{/if}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<span
									class="inline-flex shrink-0 cursor-help items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium {badgeClassFor(
										item.paymentStatus,
									)}"
								>
									{item.statusLabel}
								</span>
							</Tooltip.Trigger>
							<Tooltip.Content
								side="top"
								class="max-w-xs rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-lg"
							>
								<p class="mb-1 text-xs font-bold text-zinc-900">{tip.title}</p>
								{#if item.balanceFormatted}
									<p
										class="mb-2 font-mono text-xs font-bold"
										style="color: {ctaColorFor(item.paymentStatus)};"
									>
										Sold neachitat: {item.balanceFormatted}
									</p>
								{/if}
								<p class="text-xs leading-relaxed text-zinc-600">{tip.body}</p>
							</Tooltip.Content>
						</Tooltip.Root>
						{#if item.action}
							{@const actionColor = ctaColorFor(item.paymentStatus)}
							<button
								type="button"
								onclick={() => openLink(item.action!.url)}
								class="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border-none px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
								style="background: {actionColor};"
							>
								{item.action.label}
								<ArrowRightIcon class="size-3" />
							</button>
						{/if}
					</li>
				{/each}
			</ul>

			<!-- Footer timestamp -->
			<div class="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
				<ClockIcon class="size-3" />
				<span>
					Verificare automată orară. Ultima verificare: {formatTimestamp(data?.lastCheckedAt ?? null)}
				</span>
			</div>
		</div>
	</div>
{/if}
