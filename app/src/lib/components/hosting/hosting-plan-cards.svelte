<!--
	Cardurile de pachete hosting — aceleași pe pagina publică /pachete-hosting și
	în portalul clientului (Hosting → Pachete). Tokenii de culoare stau pe rădăcina
	componentei (nu pe .ph-page), cu variantă de dark mode pentru portal.
-->
<script lang="ts" module>
	export type HostingPlanCard = {
		id: string;
		name: string;
		description: string | null;
		features: string[] | null;
		highlightBadge: string | null;
		price: number;
		currency: string;
		billingCycle: string;
		quota: number | null;
		bandwidth: number | null;
		maxDomains: number | null;
		maxDatabases: number | null;
		maxEmailAccounts: number | null;
		ssl: boolean | null;
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		displayPrice,
		yearlyTotalRon,
		monthlyBilledRon,
		mbToGb,
		fmtCount,
		isPopular,
		tagFor,
		backupHint
	} from '$lib/utils/hosting-plan-pricing';

	let {
		packages,
		loading = false,
		yearly,
		onOrder,
		empty
	}: {
		packages: HostingPlanCard[];
		loading?: boolean;
		yearly: boolean;
		onOrder: (pkg: HostingPlanCard) => void;
		/** Conținutul afișat când nu există pachete (ex. link „Contactează-ne"). */
		empty?: Snippet;
	} = $props();
</script>

{#snippet check()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="3"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<polyline points="20 6 9 17 4 12"></polyline>
	</svg>
{/snippet}

<div class="hp-grid">
	{#if loading}
		{#each Array.from({ length: 4 }) as _, i (i)}
			<div class="hp-plan hp-skeleton" aria-hidden="true">
				<div class="hp-sk hp-sk-line hp-sk-w-32"></div>
				<div class="hp-sk hp-sk-line hp-sk-w-60"></div>
				<div class="hp-sk hp-sk-block"></div>
				<div class="hp-sk hp-sk-block-tall"></div>
			</div>
		{/each}
	{:else if packages.length === 0}
		<div class="hp-empty">
			{#if empty}{@render empty()}{:else}Pachetele sunt în curs de actualizare.{/if}
		</div>
	{:else}
		{#each packages as pkg (pkg.id)}
			{@const yearTotal = yearlyTotalRon(pkg)}
			{@const monthlyBilled = monthlyBilledRon(pkg)}
			{@const popular = isPopular(pkg)}
			<div class={['hp-plan', popular && 'popular']}>
				{#if popular}
					<span class="hp-badge">{pkg.highlightBadge}</span>
				{/if}
				<div class="hp-name">{pkg.name}</div>
				<div class="hp-tag">{tagFor(pkg)}</div>

				<div class="hp-price">
					<span class="hp-price-val">{displayPrice(pkg, yearly)}</span>
					<span class="hp-price-cur">{pkg.currency}</span>
					<span class="hp-price-per">/ lună</span>
				</div>
				<div class="hp-price-orig">
					{#if yearly}
						{yearTotal.toLocaleString('ro-RO')} {pkg.currency} / an (echivalent {monthlyBilled}
						{pkg.currency}/lună lunar)
					{:else}
						sau {yearTotal.toLocaleString('ro-RO')} {pkg.currency} anual ({Math.round(
							(1 - yearTotal / (monthlyBilled * 12)) * 100
						)}% reducere)
					{/if}
				</div>

				<button type="button" class="hp-cta" onclick={() => onOrder(pkg)}>
					Comandă {pkg.name}
				</button>

				<div class="hp-divider">Include</div>
				<ul class="hp-features">
					{#if pkg.quota !== null && pkg.quota !== undefined}
						<li>{@render check()}<span><strong>{mbToGb(pkg.quota)}</strong> spațiu SSD NVMe</span></li>
					{/if}
					{#if pkg.bandwidth !== null && pkg.bandwidth !== undefined}
						<li>{@render check()}<span><strong>{mbToGb(pkg.bandwidth)}</strong> trafic / lună</span></li>
					{/if}
					<li>{@render check()}<span><strong>{fmtCount(pkg.maxDomains)}</strong> domenii găzduite</span></li>
					<li>
						{@render check()}<span><strong>{fmtCount(pkg.maxDatabases)}</strong> baze de date MySQL</span>
					</li>
					<li>{@render check()}<span><strong>{fmtCount(pkg.maxEmailAccounts)}</strong> conturi email</span></li>
					{#if pkg.ssl}
						<li>{@render check()}<span>SSL Let's Encrypt gratuit</span></li>
					{/if}
					<li>{@render check()}<span>Backup {backupHint(pkg)}</span></li>
					<li>{@render check()}<span>PHP 8.3 + alegere versiune</span></li>
					<li>{@render check()}<span>Panou administrare · Instalare aplicații cu un click</span></li>
					{#each (pkg.features ?? []).slice(0, 3) as feat (feat)}
						<li>{@render check()}<span>{feat}</span></li>
					{/each}
				</ul>
			</div>
		{/each}
	{/if}
</div>

<style>
	.hp-grid {
		--hp-ink: #0b1220;
		--hp-ink2: #475569;
		--hp-muted: #64748b;
		--hp-border: #e5e9f0;
		--hp-card: #ffffff;
		--hp-soft: #f7f8fa;
		--hp-popular-bg: linear-gradient(180deg, #f6faff 0%, #ffffff 60%);
		--hp-accent: #1877f2;
		--hp-accent-dark: #0d5cc7;
		--hp-name: #1877f2;
		--hp-success: #10b981;
		--hp-sk: #e8edf3;
		display: grid;
		/* auto-fit: 4 pachete stau pe un rând și pe pagina publică (1150px), și în
		   portal (~960px, lângă sidebar); pe ecrane înguste coboară la 2 și 1. */
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 16px;
		font-family: 'Inter', system-ui, sans-serif;
		line-height: 1.5;
		color: var(--hp-ink);
	}
	:global(.dark) .hp-grid {
		--hp-ink: var(--foreground);
		--hp-ink2: var(--muted-foreground);
		--hp-muted: var(--muted-foreground);
		--hp-border: var(--border);
		--hp-card: var(--card);
		--hp-soft: var(--muted);
		--hp-popular-bg: linear-gradient(180deg, rgba(24, 119, 242, 0.12) 0%, var(--card) 60%);
		--hp-name: #60a5fa;
		--hp-sk: var(--muted);
	}

	.hp-plan {
		background: var(--hp-card);
		border: 1px solid var(--hp-border);
		border-radius: 18px;
		padding: 28px 24px 24px;
		display: flex;
		flex-direction: column;
		position: relative;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
	}
	.hp-plan:hover {
		transform: translateY(-3px);
		box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
	}
	.hp-plan.popular {
		border-color: var(--hp-accent);
		box-shadow: 0 12px 32px rgba(24, 119, 242, 0.14);
		background: var(--hp-popular-bg);
	}
	.hp-badge {
		position: absolute;
		top: -12px;
		left: 24px;
		background: linear-gradient(135deg, #1877f2, #0d5cc7);
		color: #ffffff;
		font-size: 11px;
		font-weight: 700;
		padding: 5px 12px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		box-shadow: 0 4px 12px rgba(24, 119, 242, 0.25);
	}
	.hp-name {
		font-size: 14px;
		font-weight: 700;
		color: var(--hp-name);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 6px;
	}
	.hp-tag {
		font-size: 13px;
		color: var(--hp-ink2);
		margin-bottom: 22px;
		min-height: 38px;
	}
	.hp-price {
		display: flex;
		align-items: baseline;
		gap: 4px;
		margin-bottom: 4px;
	}
	.hp-price-val {
		font-size: 44px;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1;
		color: var(--hp-ink);
	}
	.hp-price-cur {
		font-size: 16px;
		font-weight: 600;
		color: var(--hp-ink2);
	}
	.hp-price-per {
		font-size: 13px;
		color: var(--hp-muted);
		margin-left: 6px;
	}
	.hp-price-orig {
		font-size: 12px;
		color: var(--hp-muted);
		margin-top: 4px;
		min-height: 16px;
	}
	.hp-cta {
		display: block;
		width: 100%;
		padding: 13px 16px;
		border-radius: 10px;
		background: var(--hp-soft);
		color: var(--hp-ink);
		border: 1px solid var(--hp-border);
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		text-align: center;
		cursor: pointer;
		margin: 18px 0 22px;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.hp-cta:hover {
		background: var(--hp-ink);
		color: var(--hp-card);
		border-color: var(--hp-ink);
	}
	.hp-plan.popular .hp-cta {
		background: var(--hp-accent);
		color: #ffffff;
		border-color: var(--hp-accent);
	}
	.hp-plan.popular .hp-cta:hover {
		background: var(--hp-accent-dark);
		border-color: var(--hp-accent-dark);
	}
	.hp-divider {
		font-size: 10px;
		font-weight: 700;
		color: var(--hp-muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 12px;
	}
	.hp-features {
		list-style: none;
		padding: 0;
		margin: 0;
		flex: 1;
	}
	.hp-features li {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: 13.5px;
		color: var(--hp-ink2);
		padding: 6px 0;
	}
	.hp-features li strong {
		color: var(--hp-ink);
		font-weight: 600;
	}
	.hp-features :global(svg) {
		flex-shrink: 0;
		color: var(--hp-success);
		margin-top: 2px;
		width: 14px;
		height: 14px;
	}

	.hp-skeleton {
		gap: 14px;
	}
	.hp-sk {
		background: var(--hp-sk);
		border-radius: 8px;
		animation: hpPulse 1.4s ease-in-out infinite;
	}
	.hp-sk-line {
		height: 18px;
	}
	.hp-sk-w-32 {
		width: 60%;
	}
	.hp-sk-w-60 {
		width: 90%;
	}
	.hp-sk-block {
		height: 56px;
	}
	.hp-sk-block-tall {
		height: 200px;
	}
	@keyframes hpPulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}

	.hp-empty {
		grid-column: 1 / -1;
		text-align: center;
		padding: 60px 24px;
		color: var(--hp-ink2);
		background: var(--hp-soft);
		border: 1px solid var(--hp-border);
		border-radius: 16px;
	}
</style>
