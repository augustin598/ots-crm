<script lang="ts">
	import { getMyHourCredit } from '$lib/remotes/portal-hour-credits.remote';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { formatMinutes } from '$lib/logic/hourly-catalog';
	import { LEDGER_KIND_LABELS } from '$lib/logic/hour-credits';

	const view = $derived(await getMyHourCredit());
	const available = $derived(view.balanceMinutes - view.reservedMinutes);
	const low = $derived(view.balanceMinutes < view.lowCreditThresholdMinutes);

	function fmtDate(d: Date): string {
		return new Date(d).toLocaleDateString('ro-RO');
	}
</script>

<div class="space-y-6">
	<div class="grid gap-4 sm:grid-cols-3">
		<Card class="p-4">
			<p class="text-sm text-muted-foreground">Sold</p>
			<p class="text-3xl font-bold {low ? 'text-red-600' : ''}">
				{formatMinutes(view.balanceMinutes)}
			</p>
			{#if low}
				<Badge variant="destructive" class="mt-1">credit scăzut</Badge>
			{/if}
		</Card>
		<Card class="p-4">
			<p class="text-sm text-muted-foreground">Rezervate pe task-uri deschise</p>
			<p class="text-3xl font-bold">{formatMinutes(view.reservedMinutes)}</p>
		</Card>
		<Card class="p-4">
			<p class="text-sm text-muted-foreground">Disponibil</p>
			<p class="text-3xl font-bold {available < 0 ? 'text-amber-600' : ''}">
				{formatMinutes(available)}
			</p>
			{#if view.reference}
				<p class="mt-1 text-xs text-muted-foreground">
					1 h de credit = 1 h de {view.reference.label}; specializările mai scumpe consumă
					proporțional.
				</p>
			{/if}
		</Card>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Istoric</CardTitle>
			<CardDescription
				>Alimentări (facturi plătite, ore cumpărate), consum pe task-uri și ajustări.</CardDescription
			>
		</CardHeader>
		<CardContent>
			{#if view.entries.length === 0}
				<p class="text-sm text-muted-foreground">Nicio mișcare încă.</p>
			{:else}
				<div class="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Data</TableHead>
								<TableHead>Tip</TableHead>
								<TableHead class="text-right">Ore</TableHead>
								<TableHead>Detalii</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each view.entries as e (e.id)}
								<TableRow>
									<TableCell class="whitespace-nowrap">{fmtDate(e.createdAt)}</TableCell>
									<TableCell
										><Badge variant="outline">{LEDGER_KIND_LABELS[e.kind] ?? e.kind}</Badge
										></TableCell
									>
									<TableCell
										class="text-right font-medium {e.deltaMinutes < 0
											? 'text-red-600'
											: e.deltaMinutes > 0
												? 'text-green-700'
												: ''}"
									>
										{e.deltaMinutes > 0 ? '+' : ''}{formatMinutes(e.deltaMinutes)}
									</TableCell>
									<TableCell class="text-sm">
										{e.note ?? ''}
										{#if e.realMinutes && e.kind !== 'purchase'}
											<span class="text-xs text-muted-foreground"
												>· {formatMinutes(e.realMinutes)} lucrate</span
											>
										{/if}
									</TableCell>
								</TableRow>
							{/each}
						</TableBody>
					</Table>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
