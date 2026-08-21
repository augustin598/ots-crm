<!--
	Confirmarea din mijlocul ecranului după o acțiune pe coș (adăugat / pachet
	schimbat / scos) — pe pagina publică /servicii.

	Componentă proprie, nu sonner: pagina publică are propriul limbaj vizual (tokenii
	din .sv-page), iar sonner e stilizat pentru dashboard și stă în colț. Aici
	vizitatorul tocmai a închis comparația și trebuie să vadă clar, în centru, ce a
	intrat în ofertă și cât costă acum totul.

	Se montează cu {#key seq} din părinte, deci fiecare acțiune pornește animația și
	cronometrul de la zero.
-->
<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import { formatEur } from '$lib/constants/ots-catalog-format';
	import type { Category, Tier } from '$lib/constants/ots-catalog';
	import type { QuoteSummary } from '$lib/logic/quote-pricing';

	export type CartToastKind = 'added' | 'replaced' | 'removed' | 'cleared';

	type Props = {
		kind: CartToastKind;
		/** Serviciul vizat; lipsește la `cleared` (toată oferta). */
		category?: Category | null;
		tier?: Tier | null;
		tierLabel?: string;
		/** Sumarul coșului DUPĂ acțiune — pentru rândul „N servicii · total/lună". */
		summary: QuoteSummary;
		onView: () => void;
		onDismiss: () => void;
		/** Dacă există, apare „Anulează" (pune înapoi ce s-a scos). */
		onUndo?: () => void;
		/** ms până la închiderea automată. */
		duration?: number;
	};

	let {
		kind,
		category = null,
		tier = null,
		tierLabel = '',
		summary,
		onView,
		onDismiss,
		onUndo,
		duration = 2200
	}: Props = $props();

	const title = $derived(
		kind === 'added'
			? 'Adăugat în ofertă'
			: kind === 'replaced'
				? 'Pachet schimbat'
				: kind === 'removed'
					? 'Scos din ofertă'
					: 'Oferta a fost golită'
	);

	const price = $derived.by(() => {
		if (!category || !tier) return null;
		const monthly = category.prices[tier];
		if (monthly !== null) return `${formatEur(monthly)}/lună`;
		const setup = category.setupFees?.[tier];
		return setup ? `${formatEur(setup)} one-time` : null;
	});

	// Cronometrul se oprește cât timp mouse-ul e pe card (vizitatorul citește).
	let paused = $state(false);
	$effect(() => {
		if (paused) return;
		const t = setTimeout(onDismiss, duration);
		return () => clearTimeout(t);
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onDismiss()} />

<!-- Voalul „glass" ca în portalul clientului (factură restantă): pagina rămâne vizibilă, dar
     estompată, ca ochiul să cadă pe confirmare. Click oriunde pe voal = închide. -->
<div class="ct-backdrop" onclick={onDismiss} aria-hidden="true"></div>

<div
	class={['ct', `ct-${kind}`]}
	role="status"
	aria-live="polite"
	onmouseenter={() => (paused = true)}
	onmouseleave={() => (paused = false)}
>
	<div class="ct-badge" aria-hidden="true">
		{#if kind === 'added'}
			<CheckIcon size={18} />
		{:else if kind === 'replaced'}
			<RefreshIcon size={16} />
		{:else}
			<Trash2Icon size={16} />
		{/if}
	</div>

	<div class="ct-body">
		<div class="ct-title">{title}</div>
		{#if category && tier}
			<div class="ct-line">
				<span class="ct-icon"><CategoryIcon slug={category.slug} class="h-4 w-4" /></span>
				<strong>{category.name}</strong>
				<span class="ct-chip" data-tier={tier}>{tierLabel}</span>
				{#if price}<span class="ct-price">{price}</span>{/if}
			</div>
		{:else}
			<div class="ct-line"><strong>Toate serviciile au fost scoase.</strong></div>
		{/if}
		{#if summary.serviceCount > 0}
			<div class="ct-total">
				{summary.serviceCount} {summary.serviceCount === 1 ? 'serviciu' : 'servicii'} în ofertă
				{#if summary.discountPct > 0}
					· <em>−{summary.discountPct}%</em>
				{/if}
				· <strong>{formatEur(summary.monthlyTotal)}</strong>/lună
			</div>
		{:else}
			<div class="ct-total">Oferta e goală.</div>
		{/if}
	</div>

	<div class="ct-actions">
		{#if onUndo}
			<button type="button" class="ct-view ct-undo" onclick={onUndo}>Anulează</button>
		{:else if summary.serviceCount > 0}
			<button type="button" class="ct-view" onclick={onView}>
				Vezi oferta <ArrowRightIcon size={14} aria-hidden="true" />
			</button>
		{/if}
		<button type="button" class="ct-close" onclick={onDismiss} aria-label="Închide">
			<XIcon size={14} />
		</button>
	</div>

	<div class="ct-progress" style:animation-duration="{duration}ms" class:paused aria-hidden="true"></div>
</div>

<style>
	/* Aceiași tokeni ca .sv-page (componenta e montată în interiorul lui). */
	.ct-backdrop {
		position: fixed;
		inset: 0;
		z-index: 44; /* peste bară (40), sub card (45) */
		background: rgba(11, 18, 32, 0.22);
		backdrop-filter: blur(5px);
		-webkit-backdrop-filter: blur(5px);
		animation: ctFade 0.12s ease-out;
		cursor: pointer;
	}
	@keyframes ctFade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.ct {
		position: fixed;
		left: 50%;
		top: 50%;
		z-index: 45; /* peste bară (40), sub dialogurile bits-ui (50) și modal (999) */
		transform: translate(-50%, -50%);
		width: min(440px, calc(100vw - 32px));
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 14px;
		align-items: center;
		padding: 16px 16px 18px;
		background: rgba(255, 255, 255, 0.98);
		backdrop-filter: blur(12px);
		border: 1px solid var(--border);
		border-radius: 18px;
		box-shadow:
			0 24px 60px rgba(11, 18, 32, 0.22),
			0 4px 14px rgba(11, 18, 32, 0.08);
		color: var(--ink);
		overflow: hidden;
		animation: ctIn 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.15);
	}
	@keyframes ctIn {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.92);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}
	.ct-badge {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: white;
		background: var(--success);
		box-shadow: 0 6px 16px rgba(16, 185, 129, 0.35);
		animation: ctPop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.4) 0.04s both;
	}
	.ct-replaced .ct-badge {
		background: var(--accent);
		box-shadow: 0 6px 16px rgba(24, 119, 242, 0.35);
	}
	.ct-removed .ct-badge,
	.ct-cleared .ct-badge {
		background: #64748b;
		box-shadow: 0 6px 16px rgba(100, 116, 139, 0.3);
	}
	@keyframes ctPop {
		from {
			transform: scale(0.4);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	.ct-body {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.ct-title {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #047857;
	}
	.ct-replaced .ct-title {
		color: var(--accent-dark);
	}
	.ct-removed .ct-title,
	.ct-cleared .ct-title {
		color: var(--ink2);
	}
	.ct-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		font-size: 14px;
	}
	.ct-line strong {
		font-weight: 700;
	}
	.ct-icon {
		width: 26px;
		height: 26px;
		border-radius: 8px;
		background: var(--bg-soft);
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.ct-chip {
		--tier: #94a3b8;
		--tier-text: #475569;
		font-size: 11px;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 999px;
		color: var(--tier-text);
		border: 1px solid color-mix(in srgb, var(--tier) 35%, transparent);
		background: color-mix(in srgb, var(--tier) 10%, white);
		white-space: nowrap;
	}
	.ct-chip[data-tier='bronze'] {
		--tier: #c2823f;
		--tier-text: #9a5b1f;
	}
	.ct-chip[data-tier='gold'] {
		--tier: #d4a017;
		--tier-text: #a16207;
	}
	.ct-chip[data-tier='platinum'] {
		--tier: #1877f2;
		--tier-text: #0d5cc7;
	}
	.ct-price {
		font-size: 13px;
		color: var(--ink2);
		white-space: nowrap;
	}
	.ct-total {
		font-size: 12.5px;
		color: var(--ink2);
	}
	.ct-total em {
		font-style: normal;
		font-weight: 800;
		color: #047857;
	}
	.ct-total strong {
		color: var(--accent-dark);
		font-weight: 800;
	}
	.ct-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		align-self: stretch;
		justify-content: space-between;
	}
	.ct-close {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink2);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.ct-close:hover {
		background: var(--bg-soft);
		color: var(--ink);
	}
	.ct-view {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: 9px;
		border: none;
		background: var(--accent);
		color: white;
		font-family: inherit;
		font-size: 12.5px;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.ct-view:hover {
		background: var(--accent-dark);
	}
	.ct-undo {
		background: var(--ink);
	}
	.ct-undo:hover {
		background: #1f2937;
	}
	.ct-view:focus-visible,
	.ct-close:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	/* Bara de jos arată cât mai stă cardul pe ecran. */
	.ct-progress {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 3px;
		width: 100%;
		background: var(--success);
		transform-origin: left;
		animation-name: ctShrink;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
	}
	.ct-replaced .ct-progress {
		background: var(--accent);
	}
	.ct-removed .ct-progress,
	.ct-cleared .ct-progress {
		background: #94a3b8;
	}
	.ct-progress.paused {
		animation-play-state: paused;
	}
	@keyframes ctShrink {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}

	@media (max-width: 480px) {
		.ct {
			grid-template-columns: auto minmax(0, 1fr);
			padding: 14px 14px 16px;
		}
		.ct-actions {
			grid-column: 1 / -1;
			flex-direction: row;
			align-items: center;
			justify-content: flex-end;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ct,
		.ct-badge,
		.ct-backdrop {
			animation: none;
		}
	}
</style>
