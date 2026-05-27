<script lang="ts">
	import { focusTrap } from '$lib/actions/focus-trap';
	import HostingAccountEditForm, {
		type EditableAccount
	} from './hosting-account-edit-form.svelte';
	import { getHostingAccount } from '$lib/remotes/hosting-accounts.remote';
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	type Props = {
		/** Account id to fetch + edit. */
		accountId: string;
		onClose: () => void;
		/** Fired when the form save succeeds. Dialog closes right after. */
		onSaved?: () => void;
	};

	let { accountId, onClose, onSaved }: Props = $props();

	const accountPromise = $derived(getHostingAccount({ id: accountId, withLive: false }));

	// Body scroll lock for the lifetime of the dialog.
	$effect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	function statusBadgeClass(s: string): string {
		switch (s) {
			case 'active':
				return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
			case 'suspended':
				return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
			case 'pending':
				return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
			case 'terminated':
			case 'cancelled':
				return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
			default:
				return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
		}
	}

	function statusLabel(s: string): string {
		switch (s) {
			case 'active':
				return 'Activ';
			case 'suspended':
				return 'Suspendat';
			case 'pending':
				return 'În așteptare';
			case 'terminated':
				return 'Terminat';
			case 'cancelled':
				return 'Anulat';
			default:
				return s;
		}
	}

	function toEditable(a: Awaited<typeof accountPromise>): EditableAccount {
		return {
			id: a.id,
			domain: a.domain,
			daUsername: a.daUsername,
			status: a.status,
			clientId: a.clientId,
			daServerId: a.daServerId,
			daPackageId: a.daPackageId,
			daPackageName: a.daPackageName,
			hostingProductId: a.hostingProductId,
			startDate: a.startDate,
			nextDueDate: a.nextDueDate,
			recurringAmount: a.recurringAmount,
			currency: a.currency,
			billingCycle: a.billingCycle,
			additionalDomains: a.additionalDomains ?? null,
			autoRenew: a.autoRenew,
			paymentMethod: (a.paymentMethod === 'card' || a.paymentMethod === 'cash' ? a.paymentMethod : 'op'),
			notes: a.notes,
			tags: (a as { tags?: string[] | null }).tags ?? null
		};
	}

	function handleSaved(): void {
		onSaved?.();
		onClose();
	}
</script>

<button
	type="button"
	aria-label="Închide"
	class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm"
	onclick={onClose}
></button>

<div
	role="dialog"
	aria-modal="true"
	aria-labelledby="ha-edit-dialog-title"
	use:focusTrap={{ onEscape: onClose }}
	class="fixed left-1/2 top-1/2 z-50 flex max-h-[min(90vh,800px)] w-[min(96vw,900px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
>
	{#await accountPromise}
		<div class="flex items-center gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
			<div class="min-w-0 flex-1">
				<div id="ha-edit-dialog-title" class="text-[15px] font-bold text-slate-900 dark:text-slate-100">Editează cont hosting</div>
				<div class="mt-0.5 truncate text-[12px] text-slate-500">Se încarcă datele…</div>
			</div>
			<button
				type="button"
				aria-label="Închide"
				onclick={onClose}
				class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
			>
				<XIcon class="size-4" />
			</button>
		</div>
		<div class="flex flex-1 items-center justify-center p-12 text-sm text-slate-500">
			<LoaderCircleIcon class="mr-2 size-4 animate-spin" /> Se încarcă contul…
		</div>
	{:then account}
		<!-- Header -->
		<div class="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
			<div class="min-w-0 flex-1">
				<div id="ha-edit-dialog-title" class="text-[15px] font-bold text-slate-900 dark:text-slate-100">Editează cont hosting</div>
				<div class="mt-0.5 truncate text-[12px] text-slate-500">
					<span class="font-mono">{account.domain}</span>
					<span class="text-slate-300"> · </span>
					<span class="font-mono">{account.daUsername}</span>
				</div>
			</div>
			<span class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium {statusBadgeClass(account.status)}">
				<span class="size-1.5 rounded-full bg-current"></span>
				{statusLabel(account.status)}
			</span>
			<button
				type="button"
				aria-label="Închide"
				onclick={onClose}
				class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
			>
				<XIcon class="size-4" />
			</button>
		</div>

		<!-- Body — form fills remaining space -->
		<div class="flex flex-1 flex-col overflow-hidden">
			<HostingAccountEditForm account={toEditable(account)} onSaved={handleSaved} />
		</div>
	{:catch err}
		<div class="flex items-center gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
			<div id="ha-edit-dialog-title" class="min-w-0 flex-1 text-[15px] font-bold text-slate-900 dark:text-slate-100">
				Editează cont hosting
			</div>
			<button
				type="button"
				aria-label="Închide"
				onclick={onClose}
				class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
			>
				<XIcon class="size-4" />
			</button>
		</div>
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-sm text-red-600">
			<AlertTriangleIcon class="size-5" />
			Eroare la încărcare: {err instanceof Error ? err.message : String(err)}
		</div>
	{/await}
</div>
