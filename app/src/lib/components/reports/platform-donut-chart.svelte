<script lang="ts">
	import { browser } from '$app/environment';
	import type { Chart as ChartType } from 'chart.js';

	let {
		meta = 0,
		google = 0,
		tiktok = 0
	}: {
		meta?: number;
		google?: number;
		tiktok?: number;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: ChartType | undefined = $state();

	const total = $derived(meta + google + tiktok);

	$effect(() => {
		if (chart) { chart.destroy(); chart = undefined; }
		if (!browser || !canvas || total <= 0) return;

		(async () => {
			const { Chart, registerables } = await import('chart.js');
			Chart.register(...registerables);

			chart = new Chart(canvas, {
				type: 'doughnut',
				data: {
					labels: ['Meta Ads', 'Google Ads', 'TikTok Ads'],
					datasets: [{
						data: [meta, google, tiktok],
						backgroundColor: [
							'rgba(59, 130, 246, 0.8)',
							'rgba(16, 185, 129, 0.8)',
							'rgba(15, 23, 42, 0.8)'
						],
						borderColor: [
							'rgb(59, 130, 246)',
							'rgb(16, 185, 129)',
							'rgb(15, 23, 42)'
						],
						borderWidth: 2,
						hoverOffset: 6
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					cutout: '65%',
					plugins: {
						legend: {
							display: true,
							position: 'bottom',
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
							padding: 12,
							cornerRadius: 8,
							callbacks: {
								label: (item) => {
									const value = item.parsed;
									const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
									return ` ${item.label}: ${value.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON (${pct}%)`;
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

<div class="h-[280px] w-full">
	{#if total > 0}
		<canvas bind:this={canvas}></canvas>
	{:else}
		<div class="flex h-full items-center justify-center">
			<p class="text-muted-foreground">Nu sunt date de cheltuieli</p>
		</div>
	{/if}
</div>
