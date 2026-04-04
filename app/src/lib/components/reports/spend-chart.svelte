<script lang="ts">
	import { browser } from '$app/environment';
	import { formatCurrency } from '$lib/utils/report-helpers';
	import type { Chart as ChartType } from 'chart.js';

	let {
		data,
		currency = 'RON'
	}: {
		data: { date: string; spend: number }[];
		currency?: string;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: ChartType | undefined = $state();

	function formatDateLabel(dateStr: string): string {
		const d = new Date(dateStr + 'T00:00:00');
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
	}

	$effect(() => {
		if (chart) {
			chart.destroy();
			chart = undefined;
		}
		if (!browser || !canvas || data.length < 2) return;

		(async () => {
			const { Chart, registerables } = await import('chart.js');
			Chart.register(...registerables);

			const labels = data.map((d) => formatDateLabel(d.date));
			const values = data.map((d) => d.spend);

			// Create gradient
			const ctx = canvas.getContext('2d')!;
			const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement?.clientHeight || 300);
			gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
			gradient.addColorStop(0.5, 'rgba(59, 130, 246, 0.08)');
			gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

			chart = new Chart(canvas, {
				type: 'line',
				data: {
					labels,
					datasets: [{
						label: 'Cheltuieli',
						data: values,
						borderColor: 'rgb(59, 130, 246)',
						backgroundColor: gradient,
						fill: true,
						tension: 0.4,
						borderWidth: 2.5,
						pointRadius: 0,
						pointHoverRadius: 5,
						pointHoverBackgroundColor: 'rgb(59, 130, 246)',
						pointHoverBorderColor: '#fff',
						pointHoverBorderWidth: 2
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					interaction: { intersect: false, mode: 'index' },
					plugins: {
						legend: { display: false },
						tooltip: {
							backgroundColor: 'rgba(15, 23, 42, 0.9)',
							titleColor: '#e2e8f0',
							bodyColor: '#fff',
							borderColor: 'rgba(59, 130, 246, 0.3)',
							borderWidth: 1,
							padding: 12,
							cornerRadius: 8,
							displayColors: false,
							callbacks: {
								title: (items) => {
									const idx = items[0]?.dataIndex;
									if (idx == null) return '';
									const d = new Date(data[idx].date + 'T00:00:00');
									return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
								},
								label: (item) => `Cheltuieli: ${formatCurrency(item.parsed.y ?? 0, currency)}`
							}
						}
					},
					scales: {
						x: {
							grid: { display: false },
							border: { display: false },
							ticks: { maxRotation: 0, maxTicksLimit: 10, color: '#94a3b8', font: { size: 11 } }
						},
						y: {
							beginAtZero: true,
							border: { display: false },
							grid: { color: 'rgba(148, 163, 184, 0.1)' },
							ticks: {
								color: '#94a3b8',
								font: { size: 11 },
								callback: (value) => formatCurrency(Number(value), currency)
							}
						}
					}
				}
			});
		})();

		return () => {
			chart?.destroy();
			chart = undefined;
		};
	});
</script>

<div class="h-[300px] w-full">
	{#if data.length > 1}
		<canvas bind:this={canvas}></canvas>
	{:else if data.length === 1}
		<div class="flex h-full items-center justify-center">
			<p class="text-muted-foreground">O singură zi de date: <strong>{formatCurrency(data[0].spend, currency)}</strong></p>
		</div>
	{:else}
		<div class="flex h-full items-center justify-center">
			<p class="text-muted-foreground">Nu sunt date disponibile pentru grafic</p>
		</div>
	{/if}
</div>
