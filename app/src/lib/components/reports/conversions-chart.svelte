<script lang="ts">
	import { browser } from '$app/environment';
	import { formatCurrency, formatNumber } from '$lib/utils/report-helpers';
	import type { Chart as ChartType } from 'chart.js';

	let {
		data,
		currency = 'RON'
	}: {
		data: { date: string; conversions: number; costPerConversion: number }[];
		currency?: string;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: ChartType | undefined = $state();

	const hasConversions = $derived(data.some((d) => d.conversions > 0));

	function formatDateLabel(dateStr: string): string {
		const d = new Date(dateStr + 'T00:00:00');
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
	}

	$effect(() => {
		if (chart) {
			chart.destroy();
			chart = undefined;
		}
		if (!browser || !canvas || data.length < 1 || !hasConversions) return;

		(async () => {
			const { Chart, registerables } = await import('chart.js');
			Chart.register(...registerables);

			const labels = data.map((d) => formatDateLabel(d.date));
			const conversions = data.map((d) => d.conversions);
			const costPerConv = data.map((d) => d.costPerConversion);

			// Create gradient for bars
			const ctx = canvas.getContext('2d')!;
			const barGradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement?.clientHeight || 300);
			barGradient.addColorStop(0, 'rgba(16, 185, 129, 0.8)');
			barGradient.addColorStop(1, 'rgba(16, 185, 129, 0.2)');

			chart = new Chart(canvas, {
				type: 'bar',
				data: {
					labels,
					datasets: [
						{
							label: 'Conversii',
							data: conversions,
							backgroundColor: barGradient,
							borderColor: 'rgba(16, 185, 129, 0.9)',
							borderWidth: 0,
							borderRadius: 4,
							yAxisID: 'y',
							order: 2
						},
						{
							label: 'Cost/conversie',
							data: costPerConv,
							type: 'line',
							borderColor: 'rgb(249, 115, 22)',
							backgroundColor: 'transparent',
							tension: 0.4,
							borderWidth: 2.5,
							pointRadius: 0,
							pointHoverRadius: 5,
							pointHoverBackgroundColor: 'rgb(249, 115, 22)',
							pointHoverBorderColor: '#fff',
							pointHoverBorderWidth: 2,
							yAxisID: 'y1',
							order: 1
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					interaction: { intersect: false, mode: 'index' },
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
							borderColor: 'rgba(16, 185, 129, 0.3)',
							borderWidth: 1,
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
									if (item.datasetIndex === 0) return ` Conversii: ${formatNumber(item.parsed.y ?? 0)}`;
									return ` Cost/conversie: ${formatCurrency(item.parsed.y ?? 0, currency)}`;
								}
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
							position: 'left',
							border: { display: false },
							grid: { color: 'rgba(148, 163, 184, 0.1)' },
							title: { display: true, text: 'Conversii', color: '#94a3b8', font: { size: 11 } },
							ticks: { color: '#94a3b8', font: { size: 11 }, callback: (value) => formatNumber(Number(value)) }
						},
						y1: {
							beginAtZero: true,
							position: 'right',
							border: { display: false },
							grid: { drawOnChartArea: false },
							title: { display: true, text: 'Cost/conversie', color: '#94a3b8', font: { size: 11 } },
							ticks: { color: '#94a3b8', font: { size: 11 }, callback: (value) => formatCurrency(Number(value), currency) }
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
	{#if data.length > 0 && hasConversions}
		<canvas bind:this={canvas}></canvas>
	{:else if !hasConversions}
		<div class="flex h-full items-center justify-center">
			<p class="text-muted-foreground">Nu sunt date de conversii disponibile</p>
		</div>
	{:else}
		<div class="flex h-full items-center justify-center">
			<p class="text-muted-foreground">Nu sunt date disponibile pentru grafic</p>
		</div>
	{/if}
</div>
