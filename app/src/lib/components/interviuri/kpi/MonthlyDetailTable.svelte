<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import {
		fmtLei,
		fmtLeiFine,
		PLATFORM_IDS,
		type KpiMonthRow,
		type MonthFilter
	} from '$lib/logic/interviuri-kpi';
	import type { SourcePlatform } from './types';

	let {
		rows,
		year,
		selMonth,
		onPick,
		platforms
	}: {
		rows: KpiMonthRow[];
		year: number;
		selMonth: MonthFilter;
		onPick: (m: MonthFilter) => void;
		platforms: SourcePlatform[];
	} = $props();

	const totals = $derived.by(() => {
		const n = rows.reduce((s, r) => s + r.n, 0);
		const ok = rows.reduce((s, r) => s + r.ok, 0);
		const ads = Object.fromEntries(
			PLATFORM_IDS.map((id) => [id, rows.reduce((s, r) => s + r.ads[id], 0)])
		) as Record<string, number>;
		const fixed = rows.reduce((s, r) => s + r.fixed, 0);
		const total = rows.reduce((s, r) => s + r.total, 0);
		return { n, ok, ads, fixed, total, cpi: n ? total / n : null };
	});

	function pick(r: KpiMonthRow) {
		onPick(selMonth === r.monthNum ? 'all' : r.monthNum);
	}
</script>

<div class="cl-section" style="padding:0">
	<div class="cl-section-head" style="padding:18px 20px 14px; margin-bottom:0">
		<h3><CalendarIcon size={15} /> Detaliu lunar {year}</h3>
		<p class="cl-section-sub" style="margin-left:auto">clic pe o lună pentru a filtra toată pagina</p>
	</div>
	<div style="overflow-x:auto">
		<table class="cl-list-table">
			<thead>
				<tr>
					<th scope="col">Luna</th>
					<th scope="col" class="num">Interviuri</th>
					<th scope="col" class="num">Admise</th>
					{#each platforms as p (p.id)}<th scope="col" class="num">{p.label}</th>{/each}
					<th scope="col" class="num">Cheltuieli fixe</th>
					<th scope="col" class="num">Buget total</th>
					<th scope="col" class="num">Cost / interviu</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.monthNum)}
					{@const sel = selMonth === r.monthNum}
					<!-- rândul rămâne semantic (cifrele se citesc); tastatura folosește butonul-lună din prima celulă -->
					<tr class={sel ? 'ivk-row-sel' : ''} onclick={() => pick(r)}>
						<td>
							<button
								type="button"
								class="ivk-month-btn"
								aria-pressed={sel}
								aria-label="{r.month}: {sel ? 'elimină filtrul' : 'filtrează pagina pe această lună'}"
								onclick={(e) => {
									e.stopPropagation();
									pick(r);
								}}
							>
								{r.month}
							</button>
						</td>
						<td class="num">{r.n}</td>
						<td class="num">{r.ok}</td>
						{#each platforms as p (p.id)}
							<td class="num">{#if r.ads[p.id]}{fmtLei(r.ads[p.id])}{:else}<span class="iv-muted">—</span>{/if}</td>
						{/each}
						<td class="num">{fmtLei(r.fixed)}</td>
						<td class="num" style="font-weight:700">{fmtLei(r.total)}</td>
						<td class="num ivk-cpi-cell">{fmtLeiFine(r.cpi)}</td>
					</tr>
				{/each}
				{#if rows.length === 0}
					<tr class="ivk-static"><td colspan={6 + platforms.length}><div class="cl-budget-empty">Fără date pentru {year}.</div></td></tr>
				{/if}
			</tbody>
			<tfoot>
				<tr class="ivk-total-row">
					<th scope="row" style="text-align:left; padding:12px 14px; font-weight:800; font-size:13px; color:var(--cl-text); text-transform:none; letter-spacing:0; background:transparent; border:0">Total {year}</th>
					<td class="num" style="font-weight:800">{totals.n}</td>
					<td class="num" style="font-weight:800">{totals.ok}</td>
					{#each platforms as p (p.id)}<td class="num" style="font-weight:700">{fmtLei(totals.ads[p.id])}</td>{/each}
					<td class="num" style="font-weight:700">{fmtLei(totals.fixed)}</td>
					<td class="num" style="font-weight:800">{fmtLei(totals.total)}</td>
					<td class="num ivk-cpi-cell">{fmtLeiFine(totals.cpi)}</td>
				</tr>
			</tfoot>
		</table>
	</div>
</div>
