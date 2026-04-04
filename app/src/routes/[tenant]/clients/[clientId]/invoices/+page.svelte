<script lang="ts">
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { FileText } from '@lucide/svelte';
	import { Plus } from '@lucide/svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import CoinsIcon from '@lucide/svelte/icons/coins';

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);

	const invoicesQuery = $derived(getInvoices({ clientId }));
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
				return d.toLocaleDateString('ro-RO', {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				});
			}
		} catch {
			// ignore
		}
		return '-';
	}

	function isValidDate(date: Date | string | null | undefined): boolean {
		if (!date) return false;
		try {
			const d = date instanceof Date ? date : new Date(date);
			return !isNaN(d.getTime()) && d.getFullYear() > 1970;
		} catch {
			return false;
		}
	}

	function getStatusColor(status: string) {
		switch (status) {
			case 'paid':
				return 'success';
			case 'sent':
				return 'secondary';
			case 'draft':
				return 'outline';
			case 'overdue':
				return 'destructive';
			case 'cancelled':
				return 'destructive';
			default:
				return 'secondary';
		}
	}

	function getStatusIcon(status: string) {
		switch (status) {
			case 'paid':
				return '✓';
			case 'overdue':
				return '!';
			default:
				return '';
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Invoices</h2>
		<Button onclick={() => goto(`/${tenantSlug}/invoices/new?clientId=${clientId}`)}>
			<Plus class="h-4 w-4 mr-2" />
			New Invoice
		</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if invoices.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No invoices for this client yet</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each invoices as invoice}
				<Card class="group relative overflow-hidden border-2 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20 hover:-translate-y-0.5">
					<!-- Modern gradient accent bar -->
					<div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-primary/80 to-primary/60"></div>
					
					<div class="p-4 pt-5">
						<!-- Header with invoice number, status and View Details button -->
						<div class="flex items-center justify-between gap-4 mb-4">
							<div class="flex items-center gap-2 flex-wrap">
								<div class="flex items-center gap-1.5">
									<div class="p-1.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
										<FileTextIcon class="h-3.5 w-3.5 text-primary" />
									</div>
									<h3 class="text-lg font-bold tracking-tight text-foreground">
										{formatInvoiceNumberDisplay(invoice, invoiceSettings)}
									</h3>
								</div>
								<Badge 
									variant={getStatusColor(invoice.status)} 
									class="text-xs font-semibold px-2 py-0.5 shadow-sm"
								>
									{getStatusIcon(invoice.status)} {invoice.status}
								</Badge>
							</div>
							<Button 
								variant="outline" 
								size="sm"
								class="border-2 hover:border-primary/50 hover:bg-primary/5 transition-all flex-shrink-0" 
								onclick={() => goto(`/${tenantSlug}/invoices/${invoice.id}`)}
							>
								View Details
							</Button>
						</div>

						<div class="flex items-start justify-between gap-4">
							<div class="flex-1 min-w-0">

								<!-- Modern info grid with icons -->
								<div class="grid gap-3 md:grid-cols-4">
									<!-- Amount - Featured prominently -->
									<div class="relative p-3 rounded-lg bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10 group-hover:border-primary/20 transition-all">
										<div class="flex items-center gap-1.5 mb-1.5">
											<CoinsIcon class="h-3.5 w-3.5 text-primary/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</p>
										</div>
										<p class="text-2xl font-bold text-primary leading-tight">
											{formatAmount(invoice.totalAmount || 0, (invoice.currency || 'RON') as Currency)}
										</p>
									</div>

									<!-- Issue Date -->
									<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
										<div class="flex items-center gap-1.5 mb-1.5">
											<CalendarIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Issue Date</p>
										</div>
										<p class="text-sm font-semibold text-foreground">
											{#if invoice.issueDate && isValidDate(invoice.issueDate)}
												{formatDate(invoice.issueDate)}
											{:else}
												<span class="text-muted-foreground font-normal">Not set</span>
											{/if}
										</p>
									</div>

									<!-- Due Date -->
									<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
										<div class="flex items-center gap-1.5 mb-1.5">
											<CalendarIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Due Date</p>
										</div>
										<p class="text-sm font-semibold text-foreground">
											{#if invoice.dueDate && isValidDate(invoice.dueDate)}
												{formatDate(invoice.dueDate)}
											{:else}
												<span class="text-muted-foreground font-normal">Not set</span>
											{/if}
										</p>
									</div>

									<!-- Paid Date (conditional) -->
									{#if invoice.paidDate}
										<div class="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
											<div class="flex items-center gap-1.5 mb-1.5">
												<CalendarIcon class="h-3.5 w-3.5 text-green-600/60" />
												<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Paid Date</p>
											</div>
											<p class="text-sm font-semibold text-green-600 dark:text-green-400">
												{new Date(invoice.paidDate).toLocaleDateString('ro-RO', {
													year: 'numeric',
													month: 'short',
													day: 'numeric'
												})}
											</p>
										</div>
									{/if}
								</div>
							</div>
						</div>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>
