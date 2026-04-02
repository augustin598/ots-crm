<script lang="ts">
	import { browser } from '$app/environment';
	import type { Chart as ChartType } from 'chart.js';

	let {
		rows,
		currency = 'RON'
	}: {
		rows: { periodStart: string; periodEnd: string; adAccountName?: string | null; metaAdAccountId: string; spendCents: number; currencyCode?: string | null }[];
		currency?: string;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: ChartType | undefined = $state();

	const COLORS = [
		{ bg: 'rgba(16, 185, 129, 0.7)', border: 'rgb(16, 185, 129)' },   // emerald
		{ bg: 'rgba(59, 130, 246, 0.7)', border: 'rgb(59, 130, 246)' },    // blue
		{ bg: 'rgba(249, 115, 22, 0.7)', border: 'rgb(249, 115, 22)' },    // orange
		{ bg: 'rgba(168, 85, 247, 0.7)', border: 'rgb(168, 85, 247)' },    // purple
		{ bg: 'rgba(236, 72, 153, 0.7)', border: 'rgb(236, 72, 153)' },    // pink
		{ bg: 'rgba(234, 179, 8, 0.7)', border: 'rgb(234, 179, 8)' },      // yellow
	];

	function formatCurr(value: number): string {
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value / 100);
	}

	function formatPeriodLabel(start: string): string {
		try {
			const d = new Date(start + 'T00:00:00');
			return d.toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' });
		} catch { return start; }
	}

	function getDaysInPeriod(start: string, end: string): number {
		const s = new Date(start + 'T00:00:00');
		const e = new Date(end + 'T00:00:00');
		return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
	}

	$effect(() => {
		if (chart) { chart.destroy(); chart = undefined; }
		if (!browser || !canvas || rows.length === 0) return;

		const spendRows = rows.filter(r => r.spendCents > 0);
		if (spendRows.length === 0) return;

		// Get unique periods (sorted chronologically) and accounts
		const periods = [...new Set(spendRows.map(r => r.periodStart))].sort();
		const accounts = [...new Set(spendRows.map(r => r.adAccountName || r.metaAdAccountId))];

		(async () => {
			const { Chart, registerables } = await import('chart.js');
			Chart.register(...registerables);

			const datasets = accounts.map((account, i) => {
				const color = COLORS[i % COLORS.length];
				const data = periods.map(period => {
					const row = spendRows.find(r => r.periodStart === period && (r.adAccountName || r.metaAdAccountId) === account);
					if (!row) return 0;
					const days = getDaysInPeriod(row.periodStart, row.periodEnd);
					return Math.round(row.spendCents / days) / 100; // spend per day in currency units
				});
				return {
					label: account,
					data,
					backgroundColor: color.bg,
					borderColor: color.border,
					borderWidth: 1,
					borderRadius: 6,
				};
			});

			chart = new Chart(canvas, {
				type: 'bar',
				data: {
					labels: periods.map(formatPeriodLabel),
					datasets
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					interaction: { intersect: false, mode: 'index' },
					plugins: {
						legend: {
							display: accounts.length > 1,
							position: 'top',
							align: 'end',
							labels: {
								usePointStyle: true,
								pointStyle: 'circle',
								boxWidth: 8,
								padding: 16,
								color: '#64748b',
								font: { size: 12 }
							}
						},
						tooltip: {
							backgroundColor: 'rgba(15, 23, 42, 0.9)',
							titleColor: '#e2e8f0',
							bodyColor: '#fff',
							borderColor: 'rgba(100, 116, 139, 0.3)',
							borderWidth: 1,
							padding: 12,
							cornerRadius: 8,
							callbacks: {
								label: (item) => `${item.dataset.label}: ${formatCurr(Math.round((item.parsed.y ?? 0) * 100))} / zi`
							}
						}
					},
					scales: {
						x: {
							grid: { display: false },
							border: { display: false },
							ticks: { color: '#94a3b8', font: { size: 11 } }
						},
						y: {
							beginAtZero: true,
							border: { display: false },
							grid: { color: 'rgba(148, 163, 184, 0.1)' },
							ticks: {
								color: '#94a3b8',
								font: { size: 11 },
								callback: (value) => formatCurr(Number(value) * 100)
							}
						}
					}
				}
			});
		})();

		return () => { chart?.destroy(); chart = undefined; };
	});
</script>

<div class="h-[250px] w-full">
	{#if rows.filter(r => r.spendCents > 0).length > 0}
		<canvas bind:this={canvas}></canvas>
	{:else}
		<div class="flex h-full items-center justify-center">
			<p class="text-sm text-muted-foreground">Nu sunt date de cheltuieli</p>
		</div>
	{/if}
</div>
