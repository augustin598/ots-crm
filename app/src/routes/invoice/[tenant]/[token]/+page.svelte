<script lang="ts">
	import { page } from '$app/state';
	import { formatAmount, type Currency } from '$lib/utils/currency';

	const data = $derived(page.data as any);
	const invoice = $derived(data.invoice);
	const lineItems = $derived(data.lineItems || []);
	const tenant = $derived(data.tenant);
	const client = $derived(data.client);

	const tenantSlug = $derived(page.params.tenant);
	const token = $derived(page.params.token);

	function formatDate(dateStr: string | null) {
		if (!dateStr) return '-';
		return new Date(dateStr).toLocaleDateString('ro-RO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	function getStatusLabel(status: string) {
		const map: Record<string, string> = {
			draft: 'Ciorna',
			sent: 'Trimisa',
			paid: 'Platita',
			overdue: 'Restanta',
			cancelled: 'Anulata'
		};
		return map[status] || status;
	}

	function getStatusColor(status: string) {
		const map: Record<string, string> = {
			draft: 'bg-gray-100 text-gray-700',
			sent: 'bg-blue-100 text-blue-700',
			paid: 'bg-green-100 text-green-700',
			overdue: 'bg-red-100 text-red-700',
			cancelled: 'bg-gray-100 text-gray-500'
		};
		return map[status] || 'bg-gray-100 text-gray-700';
	}

	let downloading = $state(false);

	async function handleDownloadPDF() {
		downloading = true;
		try {
			const response = await fetch(`/invoice/${tenantSlug}/${token}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Factura-${invoice.invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			alert('Eroare la descarcarea PDF-ului. Va rugam incercati din nou.');
		} finally {
			downloading = false;
		}
	}
</script>

<svelte:head>
	<title>Factura {invoice.invoiceNumber} - {tenant.name}</title>
</svelte:head>

<div class="min-h-screen bg-gray-50">
	<div class="mx-auto max-w-3xl px-4 py-8">
		<!-- Header -->
		<div class="mb-6 text-center">
			<h1 class="text-2xl font-bold text-gray-900">{tenant.name}</h1>
		</div>

		<!-- Invoice Card -->
		<div class="rounded-lg border bg-white shadow-sm">
			<!-- Invoice Header -->
			<div class="border-b p-6">
				<div class="flex items-start justify-between">
					<div>
						<h2 class="text-xl font-semibold text-gray-900">
							Factura {invoice.invoiceNumber}
						</h2>
						<p class="mt-1 text-sm text-gray-500">Client: {client.name}</p>
					</div>
					<span class="inline-flex rounded-full px-3 py-1 text-sm font-medium {getStatusColor(invoice.status)}">
						{getStatusLabel(invoice.status)}
					</span>
				</div>
			</div>

			<!-- Invoice Details -->
			<div class="grid grid-cols-2 gap-4 border-b p-6 sm:grid-cols-4">
				<div>
					<p class="text-xs font-medium uppercase text-gray-500">Suma totala</p>
					<p class="mt-1 text-lg font-semibold text-gray-900">
						{formatAmount(invoice.totalAmount, invoice.currency as Currency)}
					</p>
				</div>
				<div>
					<p class="text-xs font-medium uppercase text-gray-500">Data emitere</p>
					<p class="mt-1 text-sm text-gray-900">{formatDate(invoice.issueDate)}</p>
				</div>
				<div>
					<p class="text-xs font-medium uppercase text-gray-500">Data scadenta</p>
					<p class="mt-1 text-sm {invoice.status === 'overdue' ? 'font-semibold text-red-600' : 'text-gray-900'}">
						{formatDate(invoice.dueDate)}
					</p>
				</div>
				<div>
					<p class="text-xs font-medium uppercase text-gray-500">Moneda</p>
					<p class="mt-1 text-sm text-gray-900">{invoice.currency}</p>
				</div>
			</div>

			<!-- Line Items -->
			{#if lineItems.length > 0}
				<div class="border-b p-6">
					<h3 class="mb-3 text-sm font-medium uppercase text-gray-500">Detalii</h3>
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b text-left text-xs uppercase text-gray-500">
									<th class="pb-2 pr-4">Descriere</th>
									<th class="pb-2 pr-4 text-right">Cantitate</th>
									<th class="pb-2 pr-4 text-right">Pret unitar</th>
									<th class="pb-2 text-right">Total</th>
								</tr>
							</thead>
							<tbody>
								{#each lineItems as item}
									<tr class="border-b last:border-0">
										<td class="py-2 pr-4">{item.description}</td>
										<td class="py-2 pr-4 text-right">
											{item.quantity}{item.unitOfMeasure ? ` ${item.unitOfMeasure}` : ''}
										</td>
										<td class="py-2 pr-4 text-right">
											{formatAmount(item.rate, (item.currency || invoice.currency) as Currency)}
										</td>
										<td class="py-2 text-right font-medium">
											{formatAmount(item.amount, (item.currency || invoice.currency) as Currency)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}

			<!-- Notes -->
			{#if invoice.notes}
				<div class="border-b p-6">
					<h3 class="mb-2 text-sm font-medium uppercase text-gray-500">Observatii</h3>
					<p class="text-sm text-gray-700">{invoice.notes}</p>
				</div>
			{/if}

			<!-- Actions -->
			<div class="p-6">
				<button
					onclick={handleDownloadPDF}
					disabled={downloading}
					class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
				>
					{#if downloading}
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
							<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
							<path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
						</svg>
						Se descarca...
					{:else}
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"></path>
						</svg>
						Descarca PDF
					{/if}
				</button>
			</div>
		</div>

		<!-- Payment Info -->
		{#if tenant.iban}
			<div class="mt-6 rounded-lg border bg-white p-6 shadow-sm">
				<h3 class="mb-3 text-sm font-medium uppercase text-gray-500">Date plata</h3>
				<div class="space-y-1 text-sm text-gray-700">
					<p><span class="font-medium">Beneficiar:</span> {tenant.name}</p>
					<p><span class="font-medium">IBAN:</span> {tenant.iban}</p>
					{#if tenant.bankName}
						<p><span class="font-medium">Banca:</span> {tenant.bankName}</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Footer -->
		<div class="mt-6 text-center text-xs text-gray-400">
			<p>Daca ati efectuat deja plata, va rugam sa ignorati acest mesaj.</p>
			<p class="mt-1">Pentru intrebari, contactati-ne la {tenant.email || tenant.name}.</p>
		</div>
	</div>
</div>
