<script lang="ts">
	/** Tabul „Raport lunar": 4 KPI + consum pe specializare + alimentare vs consum. */
	import { getMonthlyHourReport } from '$lib/remotes/hour-credits.remote';
	import { fmtHoursShort, fmtMinutes } from './hour-credits-format';

	const report = $derived(await getMonthlyHourReport());

	// Paleta barelor, în ordinea specializărilor (cea din handoff).
	const BAR_COLORS = ['#1877F2', '#a855f7', '#f59e0b', '#10b981', '#0ea5e9', '#64748b'];

	const maxRate = $derived(Math.max(...report.byRate.map((b) => b.minutes), 1));
	const maxWeek = $derived(
		Math.max(...report.weeks.flatMap((w) => [w.creditedMinutes, w.consumedMinutes]), 1)
	);
	const monthLabel = $derived(
		new Date(report.monthStart).toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
	);
</script>

<div class="hc-kpis">
	<div class="hc-kpi">
		<div class="hc-kpi-label">Creditat</div>
		<div class="hc-kpi-value">{fmtMinutes(report.creditedMinutes)}</div>
		<div class="hc-kpi-sub">din facturi plătite</div>
	</div>
	<div class="hc-kpi">
		<div class="hc-kpi-label">Cumpărat pe /servicii</div>
		<div class="hc-kpi-value">{fmtMinutes(report.purchasedMinutes)}</div>
		<div class="hc-kpi-sub">comenzi de ore plătite</div>
	</div>
	<div class="hc-kpi">
		<div class="hc-kpi-label">Consumat</div>
		<div class="hc-kpi-value">{fmtMinutes(report.consumedMinutes)}</div>
		<div class="hc-kpi-sub">pontat pe taskuri</div>
	</div>
	<div class="hc-kpi">
		<div class="hc-kpi-label">Expirat</div>
		<div class="hc-kpi-value">{fmtMinutes(report.expiredMinutes)}</div>
		<div class="hc-kpi-sub">credit neconsumat, ieșit din sold</div>
	</div>
</div>

<div class="hc-grid2">
	<div class="hc-card">
		<div class="hc-card-h">
			<h3>Consum pe specializare</h3>
			<p>{monthLabel}</p>
		</div>
		<div class="hc-card-b">
			{#if report.byRate.length === 0}
				<p class="hc-muted">Niciun consum înregistrat luna asta.</p>
			{:else}
				<div class="hc-bars">
					{#each report.byRate as bar, i (bar.slug)}
						<div class="hc-barrow">
							<span>{bar.label}</span>
							<div class="hc-bartrack">
								<div
									class="hc-barfill"
									style:width="{(bar.minutes / maxRate) * 100}%"
									style:background={BAR_COLORS[i % BAR_COLORS.length]}
								></div>
							</div>
							<span class="hc-num">{fmtHoursShort(bar.minutes)}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="hc-card">
		<div class="hc-card-h">
			<h3>Alimentare vs consum, pe săptămâni</h3>
			<p>
				{report.consumedMinutes > report.creditedMinutes + report.purchasedMinutes
					? 'Consumul depășește alimentarea luna asta.'
					: 'Alimentarea acoperă consumul luna asta.'}
			</p>
		</div>
		<div class="hc-card-b">
			<div class="hc-weeks">
				{#each report.weeks as w (w.label)}
					<div class="hc-week">
						<div class="hc-week-cols">
							<div
								class="hc-week-col"
								style:height="{(w.creditedMinutes / maxWeek) * 100}%"
								style:background="var(--cl-accent)"
								title="alimentat {fmtMinutes(w.creditedMinutes)}"
							></div>
							<div
								class="hc-week-col"
								style:height="{(w.consumedMinutes / maxWeek) * 100}%"
								style:background="var(--hc-spent)"
								title="consumat {fmtMinutes(w.consumedMinutes)}"
							></div>
						</div>
						<div class="hc-week-lab">{w.label}</div>
					</div>
				{/each}
			</div>
			<div class="hc-legend" style="margin-top:14px">
				<span><i class="hc-dot" style="background:var(--cl-accent)"></i> alimentat</span>
				<span><i class="hc-dot" style="background:var(--hc-spent)"></i> consumat</span>
			</div>
		</div>
	</div>
</div>
