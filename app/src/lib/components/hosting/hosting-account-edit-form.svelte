<script lang="ts" module>
	export type EditableAccount = {
		id: string;
		domain: string;
		daUsername: string;
		status: string;
		clientId: string | null;
		daServerId: string;
		daPackageId: string | null;
		daPackageName: string | null;
		hostingProductId: string | null;
		startDate: string | null;
		nextDueDate: string | null;
		recurringAmount: number;
		currency: string;
		billingCycle: string;
		additionalDomains: string[] | null;
		autoRenew: boolean;
		paymentMethod: 'card' | 'op' | 'cash';
		notes: string | null;
		tags: string[] | null;
	};
</script>

<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		updateHostingAccount,
		getAccountPaymentHistory,
		suspendHostingAccount,
		unsuspendHostingAccount,
		type AccountPaymentHistoryRow
	} from '$lib/remotes/hosting-accounts.remote';
	import { getDAServers, getDAPackagesForServer } from '$lib/remotes/da-servers.remote';
	import { resolveVatPercent } from '$lib/utils/vat';
	import { getHostingProducts } from '$lib/remotes/hosting-products.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import PackageIcon from '@lucide/svelte/icons/package';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import EditIcon from '@lucide/svelte/icons/pencil';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import BuildingIcon from '@lucide/svelte/icons/building';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import PaymentMethodPicker from '$lib/components/payment-method-picker.svelte';
	import { confirmDialog } from '$lib/components/ui/confirm-dialog';

	type Props = {
		account: EditableAccount;
		/** Fired after a successful save so the parent can refresh its data. */
		onSaved?: (updated: EditableAccount) => void;
	};

	let { account, onSaved }: Props = $props();

	// ---------- Local draft state ----------
	type Draft = {
		clientId: string | null;
		daPackageId: string | null;
		hostingProductId: string | null;
		domain: string;
		startDate: string;
		nextDueDate: string;
		recurringAmount: number; // cents
		recurringAmountInput: string; // user-facing currency input (whole units)
		currency: string;
		billingCycle: string;
		additionalDomains: string[];
		autoRenew: boolean;
		paymentMethod: 'card' | 'op' | 'cash';
		notes: string;
		tags: string[];
	};

	function buildDraft(a: EditableAccount): Draft {
		return {
			clientId: a.clientId,
			daPackageId: a.daPackageId,
			hostingProductId: a.hostingProductId,
			domain: a.domain,
			startDate: a.startDate ?? '',
			nextDueDate: a.nextDueDate ?? '',
			recurringAmount: a.recurringAmount,
			recurringAmountInput: (a.recurringAmount / 100).toFixed(2),
			currency: a.currency,
			billingCycle: a.billingCycle,
			additionalDomains: a.additionalDomains ?? [],
			autoRenew: a.autoRenew,
			paymentMethod: a.paymentMethod ?? 'op',
			notes: a.notes ?? '',
			tags: a.tags ?? []
		};
	}

	// svelte-ignore state_referenced_locally
	let draft = $state<Draft>(buildDraft(account));
	// svelte-ignore state_referenced_locally
	let currentStatus = $state<string>(account.status);
	// svelte-ignore state_referenced_locally
	let initializedFor = $state<string>(account.id);

	// Re-init when a different account is passed in (id change). Don't clobber
	// in-progress edits if the parent merely re-fetches the same account.
	$effect(() => {
		if (account.id !== initializedFor) {
			initializedFor = account.id;
			draft = buildDraft(account);
			currentStatus = account.status;
		}
	});

	let activeTab = $state<'package' | 'billing' | 'payment' | 'notes'>('package');
	let saving = $state(false);
	let statusBusy = $state(false);

	// ---------- Lookups ----------
	const serversPromise = getDAServers();
	const productsPromise = getHostingProducts();
	const packagesPromise = $derived(getDAPackagesForServer(account.daServerId));

	// ---------- Payment history (lazy on tab activation) ----------
	let paymentHistory = $state<AccountPaymentHistoryRow[] | null>(null);
	let paymentLoading = $state(false);
	let paymentError = $state<string | null>(null);

	async function loadPaymentHistory(): Promise<void> {
		if (paymentHistory !== null || paymentLoading) return;
		paymentLoading = true;
		paymentError = null;
		try {
			paymentHistory = await getAccountPaymentHistory(account.id);
		} catch (e) {
			paymentError = e instanceof Error ? e.message : 'Eroare la încărcare';
			paymentHistory = [];
		} finally {
			paymentLoading = false;
		}
	}

	function switchTab(t: typeof activeTab): void {
		activeTab = t;
		if (t === 'payment') void loadPaymentHistory();
	}

	// ---------- Cycle / total math ----------
	const CYCLE_LABEL: Record<string, string> = {
		monthly: 'Lunar',
		quarterly: 'Trimestrial',
		semiannually: 'Semestrial',
		biannually: 'Semestrial',
		annually: 'Anual',
		biennially: 'Bianual',
		triennially: 'Trianual',
		one_time: 'O singură dată'
	};

	type CycleTile = {
		value: string;
		label: string;
		suffix: string;
		save?: string;
	};

	const CYCLE_TILES: CycleTile[] = [
		{ value: 'monthly', label: 'Lunar', suffix: '/ lună' },
		{ value: 'annually', label: 'Anual', suffix: '/ an', save: 'cu reducere' },
		{ value: 'biennially', label: '2 ani', suffix: '/ 24 luni', save: 'cea mai bună valoare' }
	];

	// TVA dinamică din setări (invoice_settings.defaultTaxRate). Fallback 21 (standard RO)
	// doar până se încarcă setările; NU hardcodăm rata.
	let vatSettingsPromise = $state(getInvoiceSettings());
	let currentVatRate = $state<number | null>(null);
	$effect(() => {
		vatSettingsPromise
			.then((s) => {
				currentVatRate = s.defaultTaxRate;
			})
			.catch(() => {});
	});

	const totalDisplay = $derived.by(() => {
		const ron = draft.recurringAmount / 100;
		const cycleLabel =
			draft.billingCycle === 'monthly'
				? '1 lună'
				: draft.billingCycle === 'annually'
					? '12 luni'
					: draft.billingCycle === 'biennially'
						? '24 luni'
						: CYCLE_LABEL[draft.billingCycle] ?? draft.billingCycle;
		// `vat` = totalul cu TVA inclus (gross), la rata curentă a tenant-ului.
		const vat = ron * (1 + resolveVatPercent(currentVatRate) / 100);
		return {
			ron,
			vat,
			cycleLabel
		};
	});

	function formatMoney(value: number, currency: string): string {
		return new Intl.NumberFormat('ro-RO', {
			style: 'currency',
			currency,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(value);
	}

	function formatMoneyFromCents(cents: number | null, currency: string): string {
		if (cents === null) return '—';
		return formatMoney(cents / 100, currency);
	}

	function parseMoneyToCents(value: string): number {
		const clean = value.replace(/\s/g, '').replace(',', '.');
		const n = parseFloat(clean);
		if (Number.isNaN(n) || n < 0) return 0;
		return Math.round(n * 100);
	}

	function syncAmountFromInput(): void {
		draft.recurringAmount = parseMoneyToCents(draft.recurringAmountInput);
	}

	// ---------- Addon domains chip editor ----------
	let addonInput = $state('');

	function addAddon(): void {
		const v = addonInput.trim().toLowerCase();
		if (!v) return;
		if (!draft.additionalDomains.includes(v)) draft.additionalDomains = [...draft.additionalDomains, v];
		addonInput = '';
	}

	function removeAddon(d: string): void {
		draft.additionalDomains = draft.additionalDomains.filter((x) => x !== d);
	}

	// ---------- Tag chip editor ----------
	const TAG_SUGGESTIONS = [
		'VIP',
		'Migrare',
		'Datornic',
		'WooCommerce',
		'High-traffic',
		'Custom-deal'
	];
	let tagInput = $state('');

	function addTag(t?: string): void {
		const v = (t ?? tagInput).trim();
		if (!v) return;
		if (!draft.tags.includes(v)) draft.tags = [...draft.tags, v];
		tagInput = '';
	}

	function removeTag(t: string): void {
		draft.tags = draft.tags.filter((x) => x !== t);
	}

	// ---------- Status actions (immediate dispatch) ----------
	async function setStatus(target: 'active' | 'suspended'): Promise<void> {
		if (statusBusy) return;
		if (target === currentStatus) return;

		if (target === 'suspended') {
			const ok = await confirmDialog({
				title: 'Suspendă contul de hosting',
				description: `Contul ${account.daUsername} (${account.domain}) va fi suspendat pe DirectAdmin imediat. Site-ul devine inaccesibil până la reactivare.`,
				confirmLabel: 'Suspendă',
				cancelLabel: 'Anulează',
				variant: 'destructive'
			});
			if (!ok) return;
			statusBusy = true;
			const toastId = toast.loading('Se suspendă contul...');
			try {
				await suspendHostingAccount({ id: account.id, reason: 'Suspendat din panou' });
				currentStatus = 'suspended';
				toast.success('Cont suspendat', { id: toastId });
				notifySaved();
			} catch (e) {
				toast.error(e instanceof Error ? e.message : 'Eroare suspendare', { id: toastId });
			} finally {
				statusBusy = false;
			}
		} else {
			const ok = await confirmDialog({
				title: 'Reactivează contul de hosting',
				description: `Contul ${account.daUsername} (${account.domain}) va fi reactivat pe DirectAdmin. Site-ul va redeveni accesibil.`,
				confirmLabel: 'Reactivează',
				cancelLabel: 'Anulează',
				variant: 'default'
			});
			if (!ok) return;
			statusBusy = true;
			const toastId = toast.loading('Se reactivează contul...');
			try {
				await unsuspendHostingAccount(account.id);
				currentStatus = 'active';
				toast.success('Cont reactivat', { id: toastId });
				notifySaved();
			} catch (e) {
				toast.error(e instanceof Error ? e.message : 'Eroare reactivare', { id: toastId });
			} finally {
				statusBusy = false;
			}
		}
	}

	// ---------- Save ----------
	function notifySaved(): void {
		onSaved?.({
			...account,
			...draft,
			status: currentStatus,
			additionalDomains: draft.additionalDomains.length > 0 ? draft.additionalDomains : null,
			tags: draft.tags.length > 0 ? draft.tags : null,
			notes: draft.notes || null,
			startDate: draft.startDate || null,
			nextDueDate: draft.nextDueDate || null
		});
	}

	async function save(): Promise<void> {
		if (saving) return;
		syncAmountFromInput();
		saving = true;
		const toastId = toast.loading('Se salvează...');
		try {
			await updateHostingAccount({
				id: account.id,
				clientId: draft.clientId,
				daPackageId: draft.daPackageId,
				hostingProductId: draft.hostingProductId,
				domain: draft.domain,
				startDate: draft.startDate || null,
				nextDueDate: draft.nextDueDate || null,
				recurringAmount: draft.recurringAmount,
				currency: draft.currency as 'RON' | 'EUR' | 'USD',
				billingCycle: draft.billingCycle as
					| 'monthly'
					| 'quarterly'
					| 'semiannually'
					| 'biannually'
					| 'annually'
					| 'biennially'
					| 'triennially'
					| 'one_time',
				additionalDomains: draft.additionalDomains,
				autoRenew: draft.autoRenew,
				paymentMethod: draft.paymentMethod,
				notes: draft.notes || null,
				tags: draft.tags
			});
			toast.success('Modificările au fost salvate', { id: toastId });
			notifySaved();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare', { id: toastId });
		} finally {
			saving = false;
		}
	}

	const tabs = [
		{ id: 'package', label: 'Pachet', Icon: PackageIcon },
		{ id: 'billing', label: 'Abonament', Icon: CalendarIcon },
		{ id: 'payment', label: 'Plată & Factură', Icon: DollarSignIcon },
		{ id: 'notes', label: 'Note', Icon: EditIcon }
	] as const;

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
				return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
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

	function invoiceStatusPill(status: string): { label: string; cls: string } {
		switch (status) {
			case 'paid':
				return {
					label: 'Achitată',
					cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
				};
			case 'sent':
			case 'pending':
				return {
					label: 'În așteptare',
					cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
				};
			case 'overdue':
				return {
					label: 'Restantă',
					cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
				};
			case 'cancelled':
				return {
					label: 'Anulată',
					cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
				};
			case 'draft':
				return {
					label: 'Ciornă',
					cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
				};
			case 'partially_paid':
				return {
					label: 'Plată parțială',
					cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
				};
			default:
				return {
					label: status,
					cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
				};
		}
	}
</script>

<div class="flex h-full flex-col overflow-hidden bg-white dark:bg-slate-900">
	<!-- Tab navigation -->
	<div class="flex shrink-0 gap-1 border-b border-slate-200 px-5 dark:border-slate-700">
		{#each tabs as t (t.id)}
			{@const Ic = t.Icon}
			<button
				type="button"
				onclick={() => switchTab(t.id)}
				class="inline-flex items-center gap-1.5 border-b-2 px-3 py-3 text-[13px] font-medium transition-colors {activeTab === t.id
					? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
					: 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}"
			>
				<Ic class="size-3.5" />
				{t.label}
			</button>
		{/each}
	</div>

	<!-- Body -->
	<div class="flex-1 space-y-5 overflow-y-auto px-5 py-5">
		{#if activeTab === 'package'}
			<!-- ===================== PACHET ===================== -->
			{#await packagesPromise}
				<div class="text-sm text-slate-500">Se încarcă pachetele…</div>
			{:then packages}
				<!-- Active plan banner -->
				<section class="space-y-2">
					<label for="package-select" class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Pachet hosting activ</label>
					<div class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
						<div class="flex min-w-0 items-center gap-3">
							<span class="inline-flex items-center rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
								{account.daPackageName ?? '—'}
							</span>
							<div class="min-w-0">
								<div class="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
									{account.domain}
								</div>
								<div class="text-[11px] text-slate-500">DA user <span class="font-mono">{account.daUsername}</span></div>
							</div>
						</div>
						<div class="shrink-0 text-right">
							<div class="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
								{formatMoney(draft.recurringAmount / 100, draft.currency)}
							</div>
							<div class="text-[11px] text-slate-500">{CYCLE_LABEL[draft.billingCycle] ?? draft.billingCycle}</div>
						</div>
					</div>
				</section>

				<!-- Change package -->
				<section class="space-y-2">
					<label for="package-select" class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Schimbă pachet DirectAdmin</label>
					<select
						id="package-select"
						bind:value={draft.daPackageId}
						class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
					>
						<option value={null}>— Fără pachet selectat —</option>
						{#each packages as p (p.id)}
							<option value={p.id}>{p.daName}</option>
						{/each}
					</select>
					<p class="text-[11px] text-slate-500">
						Schimbarea pachetului în CRM nu modifică automat pachetul pe DA. Pentru aplicare reală, folosește
						<span class="font-medium">Sync DA</span> sau actualizează manual din DirectAdmin.
					</p>
				</section>

				<!-- Product mapping + server (read-only) -->
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<section class="space-y-2">
						<label for="product-select" class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Produs hosting (vânzare)</label>
						{#await productsPromise}
							<div class="text-xs text-slate-500">Se încarcă…</div>
						{:then products}
							<select
								id="product-select"
								bind:value={draft.hostingProductId}
								class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
							>
								<option value={null}>— Niciun produs asociat —</option>
								{#each products as pr (pr.id)}
									<option value={pr.id}>{pr.name}</option>
								{/each}
							</select>
						{/await}
					</section>

					<section class="space-y-2">
						<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Server DirectAdmin</div>
						{#await serversPromise then servers}
							{@const cur = servers.find((s) => s.id === account.daServerId)}
							<div class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
								<span class="font-mono text-[13px] text-slate-700 dark:text-slate-200">{cur?.name ?? account.daServerId}</span>
								<span class="text-[10px] uppercase tracking-wider text-slate-400">read-only</span>
							</div>
							<p class="text-[11px] text-slate-500">
								Migrarea pe alt server e operațiune separată — folosește meniul <span class="font-medium">⋯ Migrează server</span>.
							</p>
						{/await}
					</section>
				</div>

				<!-- Domain primary (read-only — rename = DA migration, audit M1) + addons -->
				<section class="space-y-2">
					<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Domeniu principal</div>
					<div class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
						<span class="font-mono text-[13px] text-slate-700 dark:text-slate-200">{draft.domain}</span>
						<span class="text-[10px] uppercase tracking-wider text-slate-400">read-only</span>
					</div>
					<p class="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
						<AlertTriangleIcon class="mt-0.5 size-3 shrink-0" />
						Domeniul nu se editează de aici — ar desincroniza CRM-ul de DirectAdmin (user-ul DA nu e redenumit). Pentru schimbarea reală a domeniului folosește un workflow de migrare DA.
					</p>
				</section>

				<section class="space-y-2">
					<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Domenii adiționale</div>
					<div class="flex flex-wrap gap-1.5">
						{#each draft.additionalDomains as d (d)}
							<span class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[12px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
								{d}
								<button type="button" aria-label="Elimină {d}" onclick={() => removeAddon(d)} class="rounded p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700">
									<XIcon class="size-3" />
								</button>
							</span>
						{:else}
							<span class="text-[11px] text-slate-400">Niciun domeniu adițional.</span>
						{/each}
					</div>
					<div class="flex gap-2">
						<input
							type="text"
							placeholder="ex: subdomeniu.exemplu.ro"
							bind:value={addonInput}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addAddon();
								}
							}}
							class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
						/>
						<button type="button" onclick={addAddon} class="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
							<PlusIcon class="size-3.5" /> Adaugă
						</button>
					</div>
				</section>

				<!-- Status (immediate action) -->
				<section class="space-y-2">
					<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Status cont</div>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							disabled={statusBusy}
							onclick={() => setStatus('active')}
							class="inline-flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 {currentStatus === 'active'
								? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950 dark:text-emerald-300'
								: 'border-slate-300 text-slate-600 hover:border-emerald-300 hover:text-emerald-600 dark:border-slate-600 dark:text-slate-300'}"
						>
							{#if statusBusy && currentStatus !== 'active'}
								<LoaderCircleIcon class="size-3.5 animate-spin" />
							{:else}
								<span class="size-2 rounded-full bg-emerald-500"></span>
							{/if}
							Activ
						</button>
						<button
							type="button"
							disabled={statusBusy}
							onclick={() => setStatus('suspended')}
							class="inline-flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 {currentStatus === 'suspended'
								? 'border-red-500 bg-red-50 text-red-700 dark:border-red-600 dark:bg-red-950 dark:text-red-300'
								: 'border-slate-300 text-slate-600 hover:border-red-300 hover:text-red-600 dark:border-slate-600 dark:text-slate-300'}"
						>
							{#if statusBusy && currentStatus !== 'suspended'}
								<LoaderCircleIcon class="size-3.5 animate-spin" />
							{:else}
								<span class="size-2 rounded-full bg-red-500"></span>
							{/if}
							Suspendat
						</button>
						{#if currentStatus !== 'active' && currentStatus !== 'suspended'}
							<span class="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-500 dark:border-slate-600">
								<span class="size-2 rounded-full bg-slate-400"></span>
								Curent: {statusLabel(currentStatus)}
							</span>
						{/if}
					</div>
					<p class="text-[11px] text-slate-500">
						Schimbarea statutului apelează imediat DirectAdmin (suspend / unsuspend) — independent de butonul Salvează.
					</p>
				</section>
			{:catch e}
				<div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
					Eroare la încărcarea pachetelor: {e instanceof Error ? e.message : String(e)}
				</div>
			{/await}
		{:else if activeTab === 'billing'}
			<!-- ===================== ABONAMENT ===================== -->
			<section class="space-y-2">
				<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Ciclu de facturare</div>
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
					{#each CYCLE_TILES as c (c.value)}
						<button
							type="button"
							onclick={() => (draft.billingCycle = c.value)}
							class="relative rounded-xl border-2 p-3 text-left transition-colors {draft.billingCycle === c.value
								? 'border-blue-500 bg-blue-50/40 dark:border-blue-500 dark:bg-blue-950/30'
								: 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'}"
						>
							<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{c.label}</div>
							<div class="mt-1 text-sm text-slate-600 dark:text-slate-300">{c.suffix}</div>
							{#if c.save}
								<div class="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">{c.save}</div>
							{/if}
							{#if draft.billingCycle === c.value}
								<div class="absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full bg-blue-600 text-white">
									<CheckIcon class="size-3" />
								</div>
							{/if}
						</button>
					{/each}
				</div>
				{#if !['monthly', 'annually', 'biennially'].includes(draft.billingCycle)}
					<p class="text-[11px] text-amber-600">
						Ciclu curent: <span class="font-semibold">{CYCLE_LABEL[draft.billingCycle] ?? draft.billingCycle}</span>.
						Schimbarea la unul din tile-urile de mai sus va suprascrie.
					</p>
				{/if}
			</section>

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<section class="space-y-2">
					<label for="start-date" class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Data start abonament</label>
					<input
						id="start-date"
						type="date"
						bind:value={draft.startDate}
						class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
					/>
				</section>
				<section class="space-y-2">
					<label for="next-due-date" class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Data expirare (next due)</label>
					<input
						id="next-due-date"
						type="date"
						bind:value={draft.nextDueDate}
						class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
					/>
				</section>
			</div>

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<section class="space-y-2">
					<label for="recurring-amount" class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Sumă recurentă (per ciclu)</label>
					<div class="relative">
						<input
							id="recurring-amount"
							type="text"
							inputmode="decimal"
							bind:value={draft.recurringAmountInput}
							onblur={syncAmountFromInput}
							class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-16 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
						/>
						<span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{draft.currency}</span>
					</div>
				</section>
				<section class="space-y-2">
					<label for="currency-select" class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Monedă</label>
					<select
						id="currency-select"
						bind:value={draft.currency}
						class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
					>
						<option value="RON">RON</option>
						<option value="EUR">EUR</option>
						<option value="USD">USD</option>
					</select>
				</section>
			</div>

			<section class="space-y-2">
				<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Opțiuni reînnoire</div>
				<label class="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
					<div class="min-w-0">
						<div class="text-sm font-semibold text-slate-900 dark:text-slate-100">Reînnoire automată</div>
						<div class="text-[11px] text-slate-500">
							La activat, sistemul re-facturează automat cu 7 zile înainte de expirare folosind metoda de plată salvată.
						</div>
					</div>
					<input type="checkbox" bind:checked={draft.autoRenew} class="size-5 accent-blue-600" />
				</label>
			</section>
		{:else if activeTab === 'payment'}
			<!-- ===================== PLATĂ & FACTURĂ ===================== -->
			<section class="space-y-2">
				<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Metodă de plată</div>
				<p class="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
					Stabilește cum se procesează facturile recurente pentru acest cont.
					<strong>Cash</strong> = chitanță emisă offline, Keez nu generează factură fiscală.
				</p>
				<PaymentMethodPicker bind:value={draft.paymentMethod} size="sm" />
			</section>
			<section class="space-y-2 pt-3">
				<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Ultimele facturi pentru acest cont</div>
				{#if paymentLoading}
					<div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
						<LoaderCircleIcon class="size-4 animate-spin" /> Se încarcă istoricul…
					</div>
				{:else if paymentError}
					<div class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
						<AlertTriangleIcon class="size-4" /> {paymentError}
					</div>
				{:else if paymentHistory && paymentHistory.length > 0}
					{@const latest = paymentHistory[0]}
					{@const latestPill = invoiceStatusPill(latest.status)}
					<!-- Hero card: latest invoice -->
					<div class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
						<div class="flex min-w-0 items-center gap-3">
							<span class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
								<FileTextIcon class="size-4" />
							</span>
							<div class="min-w-0">
								<div class="truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{latest.invoiceNumber}</div>
								<div class="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
									<span>emisă {latest.issueDate ? new Date(latest.issueDate).toLocaleDateString('ro-RO') : '—'}</span>
									<span class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold {latestPill.cls}">{latestPill.label}</span>
								</div>
							</div>
						</div>
						<div class="shrink-0 text-right">
							<div class="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatMoneyFromCents(latest.totalAmount, latest.currency)}</div>
						</div>
					</div>

					<!-- History list -->
					<div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
						<table class="w-full text-sm">
							<thead class="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-900">
								<tr>
									<th class="px-3 py-2 text-left font-medium">Factură</th>
									<th class="px-3 py-2 text-left font-medium">Emisă</th>
									<th class="px-3 py-2 text-left font-medium">Metodă</th>
									<th class="px-3 py-2 text-right font-medium">Sumă</th>
									<th class="px-3 py-2 text-left font-medium">Status</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100 dark:divide-slate-700">
								{#each paymentHistory as row (row.id)}
									{@const pill = invoiceStatusPill(row.status)}
									<tr class="hover:bg-slate-50/60 dark:hover:bg-slate-800/60">
										<td class="px-3 py-2 font-mono text-[12px] text-slate-700 dark:text-slate-200">{row.invoiceNumber}</td>
										<td class="px-3 py-2 text-[12px] text-slate-500">{row.issueDate ? new Date(row.issueDate).toLocaleDateString('ro-RO') : '—'}</td>
										<td class="px-3 py-2">
											{#if row.stripePaymentIntentId}
												<span class="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
													<CreditCardIcon class="size-3" /> Stripe
												</span>
											{:else if row.paymentMethod === 'transfer'}
												<span class="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
													<BuildingIcon class="size-3" /> Transfer
												</span>
											{:else if row.paymentMethod}
												<span class="text-[11px] text-slate-500">{row.paymentMethod}</span>
											{:else}
												<span class="text-[11px] text-slate-400">—</span>
											{/if}
										</td>
										<td class="px-3 py-2 text-right text-[12px] font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{formatMoneyFromCents(row.totalAmount, row.currency)}</td>
										<td class="px-3 py-2"><span class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold {pill.cls}">{pill.label}</span></td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="text-[11px] text-slate-500">
						Tab-ul este informativ. Metoda de plată și ID-urile de tranzacție sunt gestionate prin Stripe / modulul Facturare.
					</p>
				{:else if paymentHistory}
					<div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
						<FileTextIcon class="mx-auto mb-2 size-5 text-slate-300" />
						Niciun istoric de facturi pentru acest cont.
					</div>
				{/if}
				<div class="flex flex-wrap gap-2">
					<a
						href={`./../../../invoices?hostingAccountId=${account.id}`}
						class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
					>
						<EyeIcon class="size-3.5" /> Vezi toate facturile
					</a>
				</div>
			</section>
		{:else if activeTab === 'notes'}
			<!-- ===================== NOTE ===================== -->
			<section class="space-y-2">
				<label for="account-notes" class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Notă internă</label>
				<textarea
					id="account-notes"
					rows="5"
					placeholder="ex: clientul a cerut upgrade pentru Black Friday, plată făcută prin OP în 12.04.2025…"
					bind:value={draft.notes}
					class="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
				></textarea>
				<p class="text-[11px] text-slate-500">Vizibilă doar staff-ului OTS.</p>
			</section>

			<section class="space-y-2">
				<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Etichete</div>
				<div class="flex flex-wrap gap-1.5">
					{#each draft.tags as t (t)}
						<span class="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[12px] font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
							{t}
							<button type="button" aria-label="Elimină {t}" onclick={() => removeTag(t)} class="rounded p-0.5 hover:bg-blue-100 dark:hover:bg-blue-900">
								<XIcon class="size-3" />
							</button>
						</span>
					{:else}
						<span class="text-[11px] text-slate-400">Nicio etichetă.</span>
					{/each}
				</div>
				<div class="flex gap-2">
					<input
						type="text"
						placeholder="Adaugă etichetă personalizată…"
						bind:value={tagInput}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								addTag();
							}
						}}
						class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
					/>
					<button type="button" onclick={() => addTag()} class="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
						<PlusIcon class="size-3.5" /> Adaugă
					</button>
				</div>
				<div class="flex flex-wrap gap-1.5 pt-1">
					{#each TAG_SUGGESTIONS as s (s)}
						{#if !draft.tags.includes(s)}
							<button
								type="button"
								onclick={() => addTag(s)}
								class="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:text-slate-400"
							>
								+ {s}
							</button>
						{/if}
					{/each}
				</div>
			</section>
		{/if}
	</div>

	<!-- Footer -->
	<div class="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/50 px-5 py-3 dark:border-slate-700 dark:bg-slate-900">
		<div class="text-[11px] text-slate-500">
			Total pentru <span class="font-semibold text-slate-700 dark:text-slate-200">{totalDisplay.cycleLabel}</span>:
			<span class="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{formatMoney(totalDisplay.ron, draft.currency)}</span>
			<span class="text-slate-300">·</span>
			cu TVA: <span class="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{formatMoney(totalDisplay.vat, draft.currency)}</span>
		</div>
		<button
			type="button"
			disabled={saving}
			onclick={save}
			class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
		>
			{#if saving}
				<LoaderCircleIcon class="size-4 animate-spin" />
			{:else}
				<CheckIcon class="size-4" />
			{/if}
			Salvează modificările
		</button>
	</div>
</div>
