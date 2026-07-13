<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FileText from '@lucide/svelte/icons/file-text';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Activity from '@lucide/svelte/icons/activity';
	import { fmtCompact, formatCurrency, formatNumber, fmtDateShort } from './rk-helpers';
	import type { BudgetBurnForecast, CpaMomentum, FunnelAnalysis, SaturationMatrix, SaturationPoint, DayOfWeekMetrics } from '$lib/utils/advanced-kpi';
	import type { ExecutiveSummary } from '$lib/utils/advanced-kpi';

	let {
		summary,
		forecast,
		momentum,
		funnel,
		matrix,
		dow,
		avgHealth,
		cur = 'RON',
		open = $bindable(false)
	}: {
		summary: ExecutiveSummary;
		forecast: BudgetBurnForecast;
		momentum: CpaMomentum;
		funnel: FunnelAnalysis;
		matrix: SaturationMatrix;
		dow: DayOfWeekMetrics[];
		avgHealth: { score: number; level: string };
		cur?: string;
		open?: boolean;
	} = $props();

	const QUAD: Record<string, { c: string; label: string; desc: string }> = {
		scale: { c: '#22c55e', label: 'Scale', desc: 'Performanță bună, audiență fresh — crește bugetul' },
		refresh: { c: '#f59e0b', label: 'Refresh', desc: 'Performanță bună, audiență obosită — rotește creative-urile' },
		optimize: { c: '#3b82f6', label: 'Optimizează', desc: 'Performanță slabă, audiență fresh — testează alt creative/copy' },
		pause: { c: '#ef4444', label: 'Pauză', desc: 'Performanță slabă, audiență saturată — oprește sau resetează' }
	};

	const bandCls = $derived(avgHealth.score >= 80 ? 'good' : avgHealth.score >= 50 ? 'ok' : 'warn');
	const bandLabel = $derived(avgHealth.score >= 80 ? 'Performanță bună' : avgHealth.score >= 50 ? 'Performanță medie' : 'Necesită atenție');
	const execLvlCls = $derived(summary.healthScore >= 80 ? 'good' : summary.healthScore >= 50 ? 'ok' : 'warn');

	// funnel
	const funnelMax = $derived(funnel.steps[0]?.value || 1);
	const funnelColors = ['#3b82f6', '#ef4444', '#0ea5e9', '#10b981'];

	// saturation matrix geometry
	const MW = 360,
		MH = 320,
		pad = 30;
	const ix = (v: number) => pad + (Math.max(0, Math.min(100, v)) / 100) * (MW - pad * 2);
	const iy = (v: number) => MH - pad - (Math.max(0, Math.min(100, v)) / 100) * (MH - pad * 2);
	const mLineX = $derived(ix(matrix.medianIsc));
	const mLineY = $derived(iy(matrix.medianIpe));
	const quadCounts = $derived.by(() => {
		const c: Record<string, number> = { scale: 0, refresh: 0, optimize: 0, pause: 0 };
		matrix.points.forEach((p) => (c[p.quadrant] = (c[p.quadrant] || 0) + 1));
		return c;
	});

	function perfText(p: SaturationPoint): string {
		const fc = (v: number) => Math.round(v) + ' RON';
		if (p.roas > 0) return `ROAS ${p.roas.toFixed(1)}x · cost/conv ${fc(p.costPerConversion)}`;
		if (p.costPerConversion > 0) return `Cost/rezultat ${fc(p.costPerConversion)} · CTR ${p.ctr.toFixed(2)}%`;
		if (p.ctr > 0) return `CTR ${p.ctr.toFixed(2)}% · CPM ${fc(p.cpm)}`;
		return `CPM ${fc(p.cpm)} · freq ${p.frequency.toFixed(1)}`;
	}

	// day-of-week heatmap
	function heatColor(score: number): { bg: string; fg: string } {
		return score >= 0.66 ? { bg: '#c8f0d4', fg: '#15803d' } : score >= 0.4 ? { bg: '#fdf3c8', fg: '#a16207' } : { bg: '#fbdcdc', fg: '#b91c1c' };
	}
	const heatRows = [
		{ key: 'ctr' as const, label: 'CTR', score: 'ctrScore' as const, fmt: (v: number) => v.toFixed(2) + '%' },
		{ key: 'cpc' as const, label: 'CPC', score: 'cpcScore' as const, fmt: (v: number) => v.toFixed(2) },
		{ key: 'conversions' as const, label: 'Conv.', score: 'conversionScore' as const, fmt: (v: number) => v.toFixed(1) }
	];
</script>

<div class="rk-card rk-adv">
	<div class="rk-adv-head" role="button" tabindex="0" onclick={() => (open = !open)} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (open = !open)}>
		<div>
			<h3 class="rk-card-title">KPI Avansat &amp; Optimizare în Timp Real</h3>
			<p class="rk-card-sub">Analiză inteligentă: detecție automată a problemelor, proiecții de buget, recomandări de optimizare și clasificarea campaniilor pentru decizii rapide de scaling.</p>
		</div>
		<div class="rk-adv-head-right">
			{#if avgHealth.score > 0}
				<div class="rk-healthscore {bandCls}"><span class="rk-hs-label">Health Score</span><span class="rk-hs-num">{avgHealth.score}</span><span class="rk-hs-band">{bandLabel}</span></div>
			{/if}
			<button class="rk-adv-toggle" aria-label="Comută detaliile">{#if open}<ChevronDown size={18} />{:else}<ChevronRight size={18} />{/if}</button>
		</div>
	</div>

	{#if open}
		<div class="rk-adv-body">
			<div class="rk-adv2-top">
				<!-- left column -->
				<div class="rk-adv2-col">
					<div class="rk-adv2-card">
						<div class="rk-adv2-cardhead">
							<span class="rk-adv2-ic"><FileText size={15} /></span>
							<div><div class="rk-adv2-title">Rezumat Executiv</div><div class="rk-adv2-sub">Privire de ansamblu asupra contului</div></div>
							<span class="rk-health {execLvlCls}" style="margin-left:auto">Health: {summary.healthScore} — {summary.healthLevel}</span>
						</div>
						<div class="rk-exec-stats">
							<div><span>Cheltuieli totale</span><strong>{fmtCompact(summary.totalSpend)} RON</strong></div>
							<div><span>CPM mediu</span><strong>{summary.avgCpm.toFixed(0)} RON</strong></div>
							<div><span>CTR mediu</span><strong>{summary.avgCtr.toFixed(2)}%</strong></div>
							<div><span>Conversii</span><strong>{fmtCompact(summary.totalConversions)}</strong></div>
						</div>
						<div class="rk-exec-block">
							<div class="rk-exec-label">Top campanii (spend)</div>
							{#each summary.topCampaigns as t, i (t.name + i)}
								<div class="rk-exec-top"><span>{i + 1}. {t.name}</span><span class="rk-exec-topval">{fmtCompact(t.spend)} RON · {t.conversions} conv.</span></div>
							{/each}
						</div>
						{#if summary.topIssues.length > 0}
							<div class="rk-exec-block">
								<div class="rk-exec-label">Probleme principale</div>
								{#each summary.topIssues as it, i (i)}<div class="rk-exec-issue">{it}</div>{/each}
							</div>
						{/if}
						<div class="rk-exec-rec">{summary.recommendation}</div>
					</div>

					<div class="rk-adv2-card rk-adv2-mini">
						<div class="rk-adv2-cardhead"><span class="rk-adv2-ic"><CreditCard size={15} /></span><div class="rk-adv2-title">Proiecție lunară</div></div>
						<div class="rk-adv2-big">{fmtCompact(forecast.projectedSpend)} RON</div>
						<div class="rk-adv2-meta">
							{forecast.burnRate != null ? `Burn ${Math.round(forecast.burnRate * 100)}%` : 'Buget nesetat'} · {forecast.dailyAvgSpend.toFixed(0)} RON/zi · {forecast.daysRemaining} zile rămase
						</div>
					</div>

					<div class="rk-adv2-card rk-adv2-mini">
						<div class="rk-adv2-cardhead"><span class="rk-adv2-ic"><Activity size={15} /></span><div class="rk-adv2-title">Cost per Rezultat</div></div>
						<div class="rk-cpr">
							<div><strong>{momentum.cpa1d != null ? momentum.cpa1d.toFixed(2) : '—'}</strong><span>1z</span></div>
							<div><strong>{momentum.cpa7d != null ? momentum.cpa7d.toFixed(2) : '—'}</strong><span>7 zile</span></div>
							<div><strong>{momentum.cpa30d != null ? momentum.cpa30d.toFixed(2) : '—'}</strong><span>30 zile</span></div>
						</div>
						<div class="rk-adv2-meta {momentum.trend === 'improving' ? 'good' : momentum.trend === 'degrading' ? 'bad' : ''}">{momentum.message}</div>
					</div>
				</div>

				<!-- funnel -->
				<div class="rk-adv2-card">
					<div class="rk-adv2-title" style="margin-bottom:14px">Funnel de conversie</div>
					{#each funnel.steps as s, i (s.label)}
						<div class="rk-advfunnel-step">
							<div class="rk-advfunnel-top">
								<span style={i > 0 && s.label === funnel.worstStep ? 'color:#b91c1c;font-weight:700' : ''}>{s.label}</span>
								<span class="rk-advfunnel-val">{formatNumber(s.value)}{#if i > 0}<span class="rk-advfunnel-rate"> ({s.rate.toFixed(1)}%)</span>{/if}</span>
							</div>
							<div class="rk-advfunnel-bar"><div class="rk-advfunnel-fill" style="width:{Math.max((s.value / funnelMax) * 100, 1)}%; background:{funnelColors[i]}"></div></div>
							{#if i > 0}<div class="rk-advfunnel-drop">Drop-off: -{s.dropOff.toFixed(1)}%{s.label === funnel.worstStep ? ' (cea mai mare pierdere)' : ''}</div>{/if}
						</div>
					{/each}
				</div>

				<!-- saturation matrix -->
				<div class="rk-adv2-card">
					<div class="rk-adv2-title">Matricea de saturație</div>
					<div class="rk-adv2-sub" style="margin-bottom:10px">Performanță vs Saturație — unde să investești</div>
					<svg viewBox="0 0 {MW} {MH}" class="rk-matrix">
						<rect x={pad} y={pad} width={mLineX - pad} height={mLineY - pad} fill="#22c55e" opacity="0.06" />
						<rect x={mLineX} y={pad} width={MW - pad - mLineX} height={mLineY - pad} fill="#f59e0b" opacity="0.08" />
						<rect x={pad} y={mLineY} width={mLineX - pad} height={MH - pad - mLineY} fill="#3b82f6" opacity="0.06" />
						<rect x={mLineX} y={mLineY} width={MW - pad - mLineX} height={MH - pad - mLineY} fill="#ef4444" opacity="0.06" />
						<line x1={mLineX} y1={pad} x2={mLineX} y2={MH - pad} stroke="#cbd5e1" stroke-dasharray="3 3" />
						<line x1={pad} y1={mLineY} x2={MW - pad} y2={mLineY} stroke="#cbd5e1" stroke-dasharray="3 3" />
						<text x={(pad + mLineX) / 2} y={(pad + mLineY) / 2} text-anchor="middle" class="rk-matrix-q">Scale</text>
						<text x={(mLineX + MW - pad) / 2} y={(pad + mLineY) / 2} text-anchor="middle" class="rk-matrix-q">Refresh</text>
						<text x={(pad + mLineX) / 2} y={(mLineY + MH - pad) / 2} text-anchor="middle" class="rk-matrix-q">Optimizează</text>
						<text x={(mLineX + MW - pad) / 2} y={(mLineY + MH - pad) / 2} text-anchor="middle" class="rk-matrix-q">Pauză</text>
						{#each matrix.points as p, i (p.campaignId + i)}
							<circle cx={ix(p.isc)} cy={iy(p.ipe)} r="6" fill={QUAD[p.quadrant]?.c} opacity="0.85" stroke="white" stroke-width="1.5"><title>{p.campaignName} — {QUAD[p.quadrant]?.label}</title></circle>
						{/each}
						<text x={MW / 2} y={MH - 6} text-anchor="middle" class="rk-axis">Index Saturație →</text>
						<text x={10} y={MH / 2} text-anchor="middle" class="rk-axis" transform="rotate(-90 10 {MH / 2})">Performanță ↑</text>
					</svg>
					<div class="rk-matrix-legend">
						{#each Object.entries(QUAD) as [k, q] (k)}
							<div class="rk-matrix-leg"><span class="dot" style="background:{q.c}"></span><div><strong>{q.label} ({quadCounts[k] ?? 0})</strong><span>{q.desc}</span></div></div>
						{/each}
					</div>
				</div>
			</div>

			{#if matrix.points.length > 0}
				<div class="rk-adv2-section">
					<div class="rk-adv2-title">Analiză detaliată per campanie</div>
					<div class="rk-adv2-sub" style="margin-bottom:12px">IPE = Index Performanță · ISC = Index Saturație · Recomandare personalizată</div>
					<div class="rk-analysis-grid">
						{#each matrix.points as p, i (p.campaignId + i)}
							{@const q = QUAD[p.quadrant]}
							<div class="rk-analysis-card" style="border-top-color:{q?.c}">
								<div class="rk-analysis-head"><span class="rk-analysis-dot" style="background:{q?.c}"></span><span class="rk-analysis-name">{p.campaignName}</span><span class="rk-analysis-badge" style="color:{q?.c}">{q?.label}</span></div>
								<div class="rk-analysis-scores">
									<div><div class="rk-analysis-sl">IPE</div><div class="rk-analysis-perf">{perfText(p)}</div></div>
									<div class="rk-analysis-score" style="color:{p.ipe >= matrix.medianIpe ? '#16a34a' : '#dc2626'}">{Math.round(p.ipe)}</div>
								</div>
								<div class="rk-analysis-scores">
									<div><div class="rk-analysis-sl">ISC</div><div class="rk-analysis-perf">{p.isc >= matrix.medianIsc ? 'Audiență saturată — frequency și CPM ridicate' : 'Audiență fresh — frequency ok, spațiu de creștere'}</div></div>
									<div class="rk-analysis-score" style="color:{p.isc >= matrix.medianIsc ? '#dc2626' : '#16a34a'}">{Math.round(p.isc)}</div>
								</div>
								<div class="rk-analysis-rec">{p.recommendation}</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div class="rk-adv2-section">
				<div class="rk-adv2-title">Performanță pe zi</div>
				<div class="rk-adv2-sub" style="margin-bottom:12px">Media zilnică — verde = cel mai bun</div>
				<div class="rk-heat">
					<div class="rk-heat-row rk-heat-head">
						<div class="rk-heat-rl"></div>
						<div class="rk-heat-cells">
							{#each dow as r (r.day)}<div class="rk-heat-day">{r.dayLabel}<span>{r.lastDate ? fmtDateShort(r.lastDate) : '—'}</span></div>{/each}
						</div>
					</div>
					{#each heatRows as m (m.key)}
						<div class="rk-heat-row">
							<div class="rk-heat-rl">{m.label}</div>
							<div class="rk-heat-cells">
								{#each dow as r (r.day)}
									{@const val = r[m.key]}
									{@const col = val > 0 ? heatColor(r[m.score]) : { bg: '#f1f5f9', fg: '#94a3b8' }}
									<div class="rk-heat-cell" style="background:{col.bg}; color:{col.fg}">{val > 0 ? m.fmt(val) : '—'}</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
