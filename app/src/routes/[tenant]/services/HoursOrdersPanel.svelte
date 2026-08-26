<!--
	Comenzile de ore de extra work plătite cu cardul de pe pagina publică
	/servicii (tab „Tarife orare"). Comanda plătită E înregistrarea orelor de
	prestat; factura fiscală se emite automat de webhook și e legată aici.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import { getHoursOrders } from '$lib/remotes/packages.remote';

	const ordersQuery = getHoursOrders();
	const orders = $derived(ordersQuery.current ?? []);
	const loading = $derived(ordersQuery.loading);
	const error = $derived(ordersQuery.error);

	const STATUS_LABEL: Record<string, string> = {
		pending_payment: 'Plată neconfirmată',
		paid: 'Plătită',
		failed: 'Plată eșuată'
	};

	function statusClass(status: string): string {
		switch (status) {
			case 'paid':
				return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
			case 'failed':
				return 'bg-destructive/15 text-destructive border-destructive/30';
			default:
				return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
		}
	}

	function money(cents: number, currency: string): string {
		return `${(cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
	}

	function when(d: Date | null): string {
		if (!d) return '—';
		return new Date(d).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' });
	}

	const paidHours = $derived(
		orders.filter((o) => o.status === 'paid').reduce((sum, o) => sum + o.hours, 0)
	);
</script>

<div class="flex items-center justify-between mb-4 gap-4 flex-wrap">
	<div>
		<h2 class="text-xl font-semibold">Ore extra work cumpărate</h2>
		<p class="text-sm text-muted-foreground mt-1">
			Plătite cu cardul de pe pagina publică /servicii. Factura fiscală se emite automat la
			confirmarea plății; comenzile „neconfirmate" sunt formulare abandonate înainte de plată.
		</p>
	</div>
	{#if paidHours > 0}
		<Badge variant="outline" class="gap-1.5 text-sm py-1.5 px-3">
			<ClockIcon class="h-3.5 w-3.5" />
			{paidHours} h plătite în total
		</Badge>
	{/if}
</div>

{#if loading}
	<p class="text-muted-foreground">Se încarcă...</p>
{:else if error}
	<Card>
		<div class="p-6 flex items-start gap-3 text-destructive">
			<AlertTriangleIcon class="h-5 w-5 shrink-0 mt-0.5" />
			<div>
				<p class="font-medium">Nu am putut încărca comenzile de ore.</p>
				<p class="text-sm opacity-80">Reîncarcă pagina; dacă persistă, verifică logurile.</p>
			</div>
		</div>
	</Card>
{:else if orders.length === 0}
	<Card>
		<div class="p-10 text-center">
			<ClockIcon class="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
			<p class="text-muted-foreground">Nicio comandă de ore încă.</p>
		</div>
	</Card>
{:else}
	<Card class="overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
					<tr>
						<th class="text-left font-medium px-4 py-3">Data</th>
						<th class="text-left font-medium px-4 py-3">Client</th>
						<th class="text-left font-medium px-4 py-3">Specializare</th>
						<th class="text-right font-medium px-4 py-3">Ore</th>
						<th class="text-right font-medium px-4 py-3">Total (cu TVA)</th>
						<th class="text-left font-medium px-4 py-3">Status</th>
						<th class="text-left font-medium px-4 py-3">Factură</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each orders as o (o.id)}
						<tr class="align-top">
							<td class="px-4 py-3 whitespace-nowrap text-muted-foreground">
								{when(o.paidAt ?? o.createdAt)}
							</td>
							<td class="px-4 py-3 min-w-[180px]">
								{#if o.clientId}
									<a
										href={`/${page.params.tenant}/clients/${o.clientId}`}
										class="font-medium hover:underline"
									>
										{o.companyName ?? o.contactName}
									</a>
								{:else}
									<span class="font-medium">{o.companyName ?? o.contactName}</span>
								{/if}
								<div class="text-xs text-muted-foreground break-all">
									{#if o.companyName}{o.contactName} · {/if}{o.contactEmail}
									{#if o.cui}
										· CUI {o.cui}
									{/if}
								</div>
								{#if o.note}
									<div class="text-xs text-muted-foreground mt-1 italic line-clamp-2" title={o.note}>
										„{o.note}"
									</div>
								{/if}
							</td>
							<td class="px-4 py-3 whitespace-nowrap">
								<div class="font-medium">{o.rateLabel}</div>
								<div class="text-xs text-muted-foreground">{o.rateEur} €/h</div>
							</td>
							<td class="px-4 py-3 text-right whitespace-nowrap font-semibold tabular-nums">
								{o.hours} h
							</td>
							<td class="px-4 py-3 text-right whitespace-nowrap tabular-nums">
								<div class="font-semibold">{money(o.grossCents, o.currency)}</div>
								<div class="text-xs text-muted-foreground">
									{money(o.netCents, o.currency)} net
								</div>
							</td>
							<td class="px-4 py-3 whitespace-nowrap">
								<Badge class={statusClass(o.status)}>{STATUS_LABEL[o.status] ?? o.status}</Badge>
							</td>
							<td class="px-4 py-3 whitespace-nowrap">
								{#if o.invoiceId}
									<a
										href={`/${page.params.tenant}/invoices/${o.invoiceId}`}
										class="inline-flex items-center gap-1.5 text-primary hover:underline"
									>
										<FileTextIcon class="h-3.5 w-3.5" />
										Deschide
									</a>
								{:else if o.status === 'paid'}
									<span class="text-xs text-amber-700 dark:text-amber-300" title="Plata e confirmată, dar emiterea a eșuat — vezi logurile Keez.">
										Neemisă
									</span>
								{:else}
									<span class="text-muted-foreground">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</Card>
{/if}
