<script lang="ts">
	import { browser } from '$app/environment';
	import type { Chart as ChartType } from 'chart.js';
	import type { DailyAggregate } from '$lib/utils/report-helpers';
	import type { ChartSpec } from '$lib/utils/chart-config';

	let {
		data,
		spec,
		currency = 'RON'
	}: {
		data: DailyAggregate[];
		spec: ChartSpec;
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
		if (!browser || !canvas || data.length < 1) return;

		(async () => {
			const { Chart, registerables } = await import('chart.js');
			Chart.register(...registerables);

			const ctx = canvas.getContext('2d')!;
			const labels = data.map(d => formatDateLabel(d.date));
			const hasDualAxis = !!spec.y1Axis;

			const datasets = spec.datasets.map(ds => {
				const values = data.map(row => Number(row[ds.key]) || 0);

				if (ds.type === 'bar') {
					// Create gradient fill for bars
					const gradient = ctx.createLinearGradient(0, 0, 0, canvas!.parentElement?.clientHeight || 300);
					const baseColor = ds.color;
					gradient.addColorStop(0, ds.fillColor || baseColor.replace('rgb(', 'rgba(').replace(')', ', 0.8)'));
					gradient.addColorStop(1, ds.fillColor || baseColor.replace('rgb(', 'rgba(').replace(')', ', 0.2)'));

					return {
						label: ds.label,
						data: values,
						type: 'bar' as const,
						backgroundColor: gradient,
						borderColor: ds.color,
						borderWidth: 0,
						borderRadius: 4,
						yAxisID: ds.yAxisID,
						order: ds.order ?? 2
					};
				} else {
					// Line dataset
					const fill = !!ds.fillColor;
					let backgroundColor: string | CanvasGradient = 'transparent';
					if (fill) {
						const gradient = ctx.createLinearGradient(0, 0, 0, canvas!.parentElement?.clientHeight || 300);
						gradient.addColorStop(0, ds.fillColor!);
						gradient.addColorStop(0.5, ds.fillColor!.replace(/[\d.]+\)$/, '0.08)'));
						gradient.addColorStop(1, ds.fillColor!.replace(/[\d.]+\)$/, '0)'));
						backgroundColor = gradient;
					}

					return {
						label: ds.label,
						data: values,
						type: 'line' as const,
						borderColor: ds.color,
						backgroundColor,
						fill,
						tension: 0.4,
						borderWidth: 2.5,
						pointRadius: 0,
						pointHoverRadius: 5,
						pointHoverBackgroundColor: ds.color,
						pointHoverBorderColor: '#fff',
						pointHoverBorderWidth: 2,
						yAxisID: ds.yAxisID,
						order: ds.order ?? 1
					};
				}
			});

			chart = new Chart(canvas, {
				type: 'bar',
				data: { labels, datasets: datasets as any },
				options: {
					responsive: true,
					maintainAspectRatio: false,
					interaction: { intersect: false, mode: 'index' },
					plugins: {
						legend: {
							display: spec.datasets.length > 1,
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
							borderColor: 'rgba(59, 130, 246, 0.3)',
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
									const ds = spec.datasets[item.datasetIndex];
									if (!ds) return '';
									const value = item.parsed.y ?? 0;
									const axisSpec = ds.yAxisID === 'y1' && spec.y1Axis ? spec.y1Axis : spec.yAxis;
									return ` ${ds.label}: ${axisSpec.formatter(value, currency)}`;
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
							title: { display: true, text: spec.yAxis.label, color: '#94a3b8', font: { size: 11 } },
							ticks: {
								color: '#94a3b8',
								font: { size: 11 },
								callback: (value) => spec.yAxis.formatter(Number(value), currency)
							}
						},
						...(hasDualAxis ? {
							y1: {
								beginAtZero: true,
								position: 'right' as const,
								border: { display: false },
								grid: { drawOnChartArea: false },
								title: { display: true, text: spec.y1Axis!.label, color: '#94a3b8', font: { size: 11 } },
								ticks: {
									color: '#94a3b8',
									font: { size: 11 },
									callback: (value: string | number) => spec.y1Axis!.formatter(Number(value), currency)
								}
							}
						} : {})
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
	{#if data.length > 0}
		<canvas bind:this={canvas}></canvas>
	{:else}
		<div class="flex h-full items-center justify-center">
			<p class="text-muted-foreground">Nu sunt date disponibile pentru grafic</p>
		</div>
	{/if}
</div>
