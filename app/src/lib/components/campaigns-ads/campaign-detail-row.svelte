<script lang="ts">
	import IconEye from '@lucide/svelte/icons/eye';
	import IconChartColumn from '@lucide/svelte/icons/chart-column';
	import { getMetaCampaignAdsets } from '$lib/remotes/meta-campaigns.remote';
	import { fmtMoney, fmtNum, type CampaignRow } from '$lib/utils/meta-campaigns';
	import StatusBadge from './status-badge.svelte';

	interface Props {
		row: CampaignRow;
		adAccountId: string;
		tenantSlug: string;
		currency: string;
		span: number;
	}

	let { row, adAccountId, tenantSlug, currency, span }: Props = $props();

	// Query lazy: componenta se montează doar când rândul e expandat,
	// deci fetch-ul pornește exact la expandare (pattern reports/+page.svelte).
	const adsetsQuery = $derived(getMetaCampaignAdsets({ adAccountId, campaignId: row.id }));

	const adsetCurrency = $derived(adsetsQuery.current?.accountCurrency ?? currency);
	const reportHref = $derived(`/${tenantSlug}/reports/facebook-ads?account=${adAccountId}`);

	function openPreview() {
		if (row.previewUrl) window.open(row.previewUrl, '_blank');
	}
</script>

<tr class="expand-row">
	<td colspan={span}>
		<div class="expand-content">
			<div class="expand-section">
				<h4>Ad seturi & buget <span class="detail-window">(ultimele 7 zile)</span></h4>
				{#if adsetsQuery.error}
					<p class="detail-note">Ad seturile nu au putut fi încărcate. Încearcă din nou mai târziu.</p>
				{:else if adsetsQuery.current}
					{#if adsetsQuery.current.adsets.length === 0}
						<p class="detail-note">Campania nu are ad seturi.</p>
					{:else}
						<div class="adset-wrap">
							<table class="adset-table">
								<thead>
									<tr>
										<th>Ad set</th>
										<th>Status</th>
										<th class="num">Buget/zi</th>
										<th class="num">Cheltuit</th>
										<th class="num">CPL</th>
									</tr>
								</thead>
								<tbody>
									{#each adsetsQuery.current.adsets as adset (adset.id)}
										<tr>
											<td class="adset-name" title={adset.name}>{adset.name}</td>
											<td><StatusBadge status={adset.status} /></td>
											<td class="num">
												{adset.daily_budget ? fmtMoney(adset.daily_budget / 100, adsetCurrency) : '—'}
											</td>
											<td class="num">{adset.spend ? fmtMoney(adset.spend, adsetCurrency) : '—'}</td>
											<td class="num">{adset.cpl === null ? '—' : fmtMoney(adset.cpl / 100, adsetCurrency)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{:else}
					<p class="detail-note">Se încarcă ad seturile…</p>
				{/if}
			</div>
			<div class="expand-section">
				<h4>Performanță (perioada selectată)</h4>
				<div class="perf-grid">
					<div class="perf-card">
						<div class="perf-label">Reach</div>
						<div class="perf-value">{fmtNum(row.reach)}</div>
					</div>
					<div class="perf-card">
						<div class="perf-label">Clicuri</div>
						<div class="perf-value">{fmtNum(row.clicks)}</div>
					</div>
					<div class="perf-card">
						<div class="perf-label">Conversii</div>
						<div class="perf-value">{row.conversions > 0 ? row.conversions : '—'}</div>
					</div>
				</div>
				<div class="detail-actions">
					{#if row.previewUrl}
						<button class="btn sm primary" onclick={openPreview}><IconEye /> Deschide preview</button>
					{/if}
					<a class="btn sm" href={reportHref}><IconChartColumn /> Raport detaliat</a>
				</div>
			</div>
		</div>
	</td>
</tr>

<style>
	.detail-window {
		font-weight: 400;
		font-size: 11px;
		color: var(--ca-text-3);
		text-transform: none;
		letter-spacing: 0;
	}

	.detail-note {
		font-size: 12px;
		color: var(--ca-text-3);
		margin: 0;
	}
	.detail-actions {
		margin-top: 14px;
		display: flex;
		gap: 8px;
	}
	.adset-wrap {
		background: white;
		border: 1px solid var(--ca-border);
		border-radius: 8px;
		overflow: hidden;
	}
	.adset-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	/* Neutralizează regulile globale .ca-page .table care se aplică și tabelului imbricat
	   (sticky columns, padding, borduri pe tr). */
	.adset-table th {
		position: static;
		box-shadow: none;
		text-align: left;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ca-text-3);
		font-weight: 600;
		padding: 6px 10px;
		background: var(--ca-surface-2);
		border-bottom: 1px solid var(--ca-border);
	}
	.adset-table tr {
		border-bottom: none;
	}
	.adset-table td {
		position: static;
		box-shadow: none;
		padding: 6px 10px;
		border-bottom: 1px solid var(--ca-border);
		background: white;
		vertical-align: middle;
	}
	.adset-table tbody tr:last-child td {
		border-bottom: none;
	}
	.adset-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.adset-name {
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
</style>
