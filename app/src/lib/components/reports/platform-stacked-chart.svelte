<script lang="ts">
	import { browser } from '$app/environment';
	import type { Chart as ChartType } from 'chart.js';

	let {
		data
	}: {
		data: { date: string; meta: number; google: number; tiktok: number }[];
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: ChartType | undefined = $state();

	function formatDateLabel(dateStr: string): string {
		const d = new Date(dateStr + 'T00:00:00');
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
	}

	$effect(() => {
		if (chart) { chart.destroy(); chart = undefined; }
		if (!browser || !canvas || data.length < 1) return;

		(async () => {
			const { Chart, registerables } = await import('chart.js');
			Chart.register(...registerables);

			const labels = data.map(d => formatDateLabel(d.date));

			chart = new Chart(canvas, {
				type: 'bar',
				data: {
					labels,
					datasets: [
						{
							label: 'Meta Ads',
							data: data.map(d => d.meta),
							backgroundColor: 'rgba(59, 130, 246, 0.7)',
							borderColor: 'rgb(59, 130, 246)',
							borderWidth: 0,
							borderRadius: 2,
							order: 3
						},
						{
							label: 'Google Ads',
							data: data.map(d => d.google),
							backgroundColor: 'rgba(16, 185, 129, 0.7)',
							borderColor: 'rgb(16, 185, 129)',
							borderWidth: 0,
							borderRadius: 2,
							order: 2
						},
						{
							label: 'TikTok Ads',
							data: data.map(d => d.tiktok),
							backgroundColor: 'rgba(15, 23, 42, 0.7)',
							borderColor: 'rgb(15, 23, 42)',
							borderWidth: 0,
							borderRadius: 2,
							order: 1
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					interaction: { intersect: false, mode: 'index' },
					scales: {
						x: {
							stacked: true,
							grid: { display: false },
							border: { display: false },
							ticks: { maxRotation: 0, maxTicksLimit: 12, color: '#94a3b8', font: { size: 11 } }
						},
						y: {
							stacked: true,
							beginAtZero: true,
							border: { display: false },
							grid: { color: 'rgba(148, 163, 184, 0.1)' },
							ticks: {
								color: '#94a3b8',
								font: { size: 11 },
								callback: (value) => Number(value).toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' RON'
							}
						}
					},
					plugins: {
						legend: {
							display: true,
							position: 'top',
							align: 'end',
							labels: {
								usePointStyle: true,
								pointStyle: 'circle',
								boxWidth: 8,
								boxHeight: 8,
								padding: 16,
								color: '#64748b',
								font: { size: 12 }
							}
						},
						tooltip: {
							backgroundColor: 'rgba(15, 23, 42, 0.9)',
							titleColor: '#e2e8f0',
							bodyColor: '#fff',
							padding: 12,
							cornerRadius: 8,
							callbacks: {
								title: (items) => {
									const idx = items[0]?.dataIndex;
									if (idx == null) return '';
									const d = new Date(data[idx].date + 'T00:00:00');
									return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
								},
								label: (item) => {
									const val = item.parsed.y ?? 0;
									return ` ${item.dataset.label}: ${val.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON`;
								},
								footer: (items) => {
									const total = items.reduce((s, i) => s + (i.parsed.y ?? 0), 0);
									return `Total: ${total.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON`;
								}
							}
						}
					}
				}
			});
		})();

		return () => { chart?.destroy(); chart = undefined; };
	});
</script>

<div class="h-[300px] w-full">
	{#if data.length > 0}
		<canvas bind:this={canvas}></canvas>
	{:else}
		<div class="flex h-full items-center justify-center">
			<p class="text-muted-foreground">Nu sunt date disponibile</p>
		</div>
	{/if}
</div>
