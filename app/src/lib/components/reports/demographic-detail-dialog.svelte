<script lang="ts">
	import { browser } from '$app/environment';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { formatCurrency, formatNumber } from '$lib/utils/report-helpers';
	import type { DemographicSegment } from '$lib/server/meta-ads/client';
	import type { Chart as ChartType } from 'chart.js';

	let {
		open = $bindable(false),
		title,
		data,
		currency = 'RON',
		labelMap,
		colors,
		resultLabel = 'Rezultate'
	}: {
		open: boolean;
		title: string;
		data: DemographicSegment[];
		currency?: string;
		labelMap: (label: string) => string;
		colors: string[];
		resultLabel?: string;
	} = $props();

	const hasResults = $derived(data.some(d => d.results > 0));

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: ChartType | undefined = $state();

	const totalSpend = $derived(data.reduce((s, d) => s + d.spend, 0));

	$effect(() => {
		if (chart) {
			chart.destroy();
			chart = undefined;
		}
		if (!browser || !canvas || !open || data.length === 0) return;

		(async () => {
			const { Chart, registerables } = await import('chart.js');
			Chart.register(...registerables);

			const labels = data.map(d => labelMap(d.label));
			const values = data.map(d => d.spend);
			const bgColors = data.map((_, i) => colors[i % colors.length]);

			chart = new Chart(canvas, {
				type: 'bar',
				data: {
					labels,
					datasets: [{
						label: 'Cheltuieli',
						data: values,
						backgroundColor: bgColors,
						borderRadius: 4,
						barThickness: data.length > 10 ? 16 : 24
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					indexAxis: 'y',
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
							callbacks: {
								label: (item) => {
									const segment = data[item.dataIndex];
									const pct = totalSpend > 0 ? ((segment.spend / totalSpend) * 100).toFixed(1) : '0';
									const lines = [
										`Cheltuieli: ${formatCurrency(segment.spend, currency)} (${pct}%)`,
										`Impresii: ${formatNumber(segment.impressions)}`,
										`Click-uri: ${formatNumber(segment.clicks)}`
									];
									if (hasResults) lines.push(`${resultLabel}: ${formatNumber(segment.results)}`);
									return lines;
								}
							}
						}
					},
					scales: {
						x: {
							beginAtZero: true,
							grid: { color: 'rgba(148, 163, 184, 0.1)' },
							border: { display: false },
							ticks: {
								color: '#94a3b8',
								font: { size: 11 },
								callback: (value) => formatCurrency(Number(value), currency)
							}
						},
						y: {
							grid: { display: false },
							border: { display: false },
							ticks: { color: '#64748b', font: { size: 12 } }
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

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[650px] max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>Distribuție cheltuieli pe {title.toLowerCase()}</Dialog.Description>
		</Dialog.Header>

		{#if data.length > 0}
			<div class="h-[{Math.max(data.length * 36, 200)}px] min-h-[200px] w-full py-2" style="height: {Math.max(data.length * 36, 200)}px">
				<canvas bind:this={canvas}></canvas>
			</div>

			<div class="rounded-md border mt-4 overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Segment</TableHead>
							<TableHead class="text-right">Cheltuieli</TableHead>
							<TableHead class="text-right">Impresii</TableHead>
							<TableHead class="text-right">Click-uri</TableHead>
							{#if hasResults}<TableHead class="text-right">{resultLabel}</TableHead>{/if}
							<TableHead class="text-right">% Total</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each data as segment, i}
							<TableRow>
								<TableCell>
									<div class="flex items-center gap-2">
										<div class="h-3 w-3 rounded-sm flex-shrink-0" style="background-color: {colors[i % colors.length]}"></div>
										{labelMap(segment.label)}
									</div>
								</TableCell>
								<TableCell class="text-right tabular-nums">{formatCurrency(segment.spend, currency)}</TableCell>
								<TableCell class="text-right tabular-nums">{formatNumber(segment.impressions)}</TableCell>
								<TableCell class="text-right tabular-nums">{formatNumber(segment.clicks)}</TableCell>
								{#if hasResults}<TableCell class="text-right tabular-nums">{formatNumber(segment.results)}</TableCell>{/if}
								<TableCell class="text-right tabular-nums">{totalSpend > 0 ? ((segment.spend / totalSpend) * 100).toFixed(1) : '0'}%</TableCell>
							</TableRow>
						{/each}
						<TableRow class="bg-muted/50 font-semibold border-t-2">
							<TableCell>Total</TableCell>
							<TableCell class="text-right tabular-nums">{formatCurrency(totalSpend, currency)}</TableCell>
							<TableCell class="text-right tabular-nums">{formatNumber(data.reduce((s, d) => s + d.impressions, 0))}</TableCell>
							<TableCell class="text-right tabular-nums">{formatNumber(data.reduce((s, d) => s + d.clicks, 0))}</TableCell>
							{#if hasResults}<TableCell class="text-right tabular-nums">{formatNumber(data.reduce((s, d) => s + d.results, 0))}</TableCell>{/if}
							<TableCell class="text-right tabular-nums">100%</TableCell>
						</TableRow>
					</TableBody>
				</Table>
			</div>
		{:else}
			<div class="flex items-center justify-center h-32">
				<p class="text-muted-foreground">Nu sunt date disponibile</p>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
