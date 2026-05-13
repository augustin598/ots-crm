<script lang="ts">
	import {
		getHostingInquiries,
		updateHostingInquiryStatus,
		deleteHostingInquiry
	} from '$lib/remotes/hosting-inquiries.remote';
	import { toast } from 'svelte-sonner';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	let inquiries = $state(getHostingInquiries());
	let statusFilter = $state<'all' | 'new' | 'contacted' | 'converted' | 'discarded'>('new');

	function refresh() {
		inquiries = getHostingInquiries();
	}

	async function setStatus(
		id: string,
		status: 'new' | 'contacted' | 'converted' | 'discarded'
	) {
		try {
			await updateHostingInquiryStatus({ id, status });
			toast.success('Status actualizat');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleDelete(id: string) {
		if (!confirm('Ștergi această cerere?')) return;
		try {
			await deleteHostingInquiry(id);
			toast.success('Cerere ștearsă');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	function fmtDate(d: string | Date | null): string {
		if (!d) return '—';
		try {
			return new Date(d).toLocaleString('ro-RO');
		} catch {
			return String(d);
		}
	}

	function statusColor(s: string) {
		switch (s) {
			case 'new':
				return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
			case 'contacted':
				return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
			case 'converted':
				return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
			case 'discarded':
				return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
			default:
				return 'bg-slate-100 text-slate-700';
		}
	}
	function statusLabel(s: string) {
		const m: Record<string, string> = {
			new: 'Nou',
			contacted: 'Contactat',
			converted: 'Convertit',
			discarded: 'Respins'
		};
		return m[s] ?? s;
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">Cereri ofertă hosting</h1>
		<p class="text-slate-500">Cereri primite prin pagina publică <code>/pachete-hosting</code></p>
	</div>

	<div class="flex flex-wrap gap-2">
		{#each ['new', 'contacted', 'converted', 'discarded', 'all'] as s}
			<button
				onclick={() => (statusFilter = s as typeof statusFilter)}
				class="rounded-lg border px-3 py-1.5 text-sm {statusFilter === s
					? 'border-primary bg-primary/10 font-medium'
					: 'border-slate-200 dark:border-slate-700'}"
			>
				{s === 'all' ? 'Toate' : statusLabel(s)}
			</button>
		{/each}
	</div>

	{#await inquiries}
		<div class="rounded-xl border bg-white p-8 text-center text-slate-500 dark:bg-slate-800">
			Se încarcă...
		</div>
	{:then list}
		{@const filtered = statusFilter === 'all' ? list : list.filter((i) => i.status === statusFilter)}
		{#if filtered.length === 0}
			<div class="rounded-xl border bg-white p-12 text-center text-slate-500 dark:bg-slate-800">
				Nicio cerere {statusFilter !== 'all' ? `cu status "${statusLabel(statusFilter)}"` : ''}.
			</div>
		{:else}
			<div class="space-y-3">
				{#each filtered as inq (inq.id)}
					<div class="overflow-hidden rounded-xl border bg-white dark:bg-slate-800">
						<div class="flex items-start justify-between gap-3 p-5">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<h3 class="text-lg font-semibold">{inq.contactName}</h3>
									<span class="rounded-full px-2 py-0.5 text-xs font-medium {statusColor(inq.status)}">
										{statusLabel(inq.status)}
									</span>
									{#if inq.productName}
										<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
											{inq.productName}
										</span>
									{/if}
								</div>
								<div class="mt-2 grid gap-1 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
									<div class="flex items-center gap-1.5">
										<MailIcon class="size-3.5" />
										<a href="mailto:{inq.contactEmail}" class="underline">{inq.contactEmail}</a>
									</div>
									{#if inq.contactPhone}
										<div class="flex items-center gap-1.5">
											<PhoneIcon class="size-3.5" />
											<a href="tel:{inq.contactPhone}" class="underline">{inq.contactPhone}</a>
										</div>
									{/if}
									{#if inq.companyName}
										<div class="flex items-center gap-1.5">
											<Building2Icon class="size-3.5" />
											{inq.companyName}{inq.vatNumber ? ` (${inq.vatNumber})` : ''}
										</div>
									{/if}
								</div>
								{#if inq.message}
									<p class="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
										{inq.message}
									</p>
								{/if}
								<p class="mt-2 text-xs text-slate-400">
									Primit: {fmtDate(inq.createdAt)}
									{#if inq.contactedAt}· Contactat: {fmtDate(inq.contactedAt)}{/if}
									{#if inq.ipAddress}· IP: {inq.ipAddress}{/if}
								</p>
							</div>
							<button
								onclick={() => handleDelete(inq.id)}
								class="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
								title="Șterge"
							>
								<TrashIcon class="size-4" />
							</button>
						</div>
						<div class="flex flex-wrap gap-2 border-t bg-slate-50 px-5 py-3 dark:bg-slate-900/50">
							{#each ['new', 'contacted', 'converted', 'discarded'] as s}
								{#if s !== inq.status}
									<button
										onclick={() => setStatus(inq.id, s as 'new' | 'contacted' | 'converted' | 'discarded')}
										class="rounded border px-2.5 py-1 text-xs hover:bg-white dark:hover:bg-slate-800"
									>
										→ {statusLabel(s)}
									</button>
								{/if}
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/await}
</div>
