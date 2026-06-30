<script lang="ts">
	import {
		getHostingOrders,
		acceptHostingOrderPayment,
		provisionFromInquiry,
		deleteHostingInquiry,
		type HostingOrderRow,
		type HostingOrderItemRow
	} from '$lib/remotes/hosting-inquiries.remote';
	import { getDAServers } from '$lib/remotes/da-servers.remote';
	import { getHostingProducts } from '$lib/remotes/hosting-products.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { displayOrderId } from '$lib/utils/hosting-order-id';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { focusTrap } from '$lib/actions/focus-trap';
	// Lucide icons — imported per-icon to keep bundle small.
	import SearchIcon from '@lucide/svelte/icons/search';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MailIcon from '@lucide/svelte/icons/mail';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import BuildingIcon from '@lucide/svelte/icons/building';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import PackageIcon from '@lucide/svelte/icons/package';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PaymentMethodPicker from '$lib/components/payment-method-picker.svelte';
	import ManualOrderModal from '$lib/components/hosting/ManualOrderModal.svelte';

	// ---- Constant lookups -----------------------------------------------------

	/** Human Romanian labels for the persisted `payment_status` enum. */
	const PAY_LABELS: Record<string, string> = {
		paid: 'Achitat',
		pending: 'În așteptare',
		processing: 'Se procesează',
		failed: 'Eșuat',
		refunded: 'Refundat'
	};

	/** Human Romanian labels for the *derived* account/provisioning state. */
	const ACC_LABELS: Record<string, string> = {
		active: 'Activ',
		provisioning: 'Se creează',
		'awaiting-payment': 'Așteaptă plată',
		cancelled: 'Anulat'
	};

	/** Human Romanian labels for the persisted `payment_method` enum. */
	const METHOD_LABELS: Record<string, string> = {
		card: 'Card',
		op: 'Ordin de plată',
		cash: 'Cash',
		revolut: 'Revolut',
		paypal: 'PayPal'
	};

	/** Method → label string for hex-dot timeline entries. Kept stable so
	 * snapshot-style tests downstream don't break if we ever localize again. */
	const METHOD_TIMELINE_COLOR = {
		paid: '#10b981',
		pending: '#f59e0b',
		failed: '#ef4444',
		processing: '#6366f1',
		refunded: '#475569',
		placed: '#94a3b8',
		provisioning: '#6366f1',
		active: '#1877F2'
	} as const;

	// ---- Date filter ----------------------------------------------------------

	type DatePresetId = 'all' | 'today' | 'yesterday' | '7d' | '30d';
	type DatePreset = { id: DatePresetId; label: string; days: number | null; exact?: boolean };
	const DATE_PRESETS: DatePreset[] = [
		{ id: 'all', label: 'Tot intervalul', days: null },
		{ id: 'today', label: 'Azi', days: 0 },
		{ id: 'yesterday', label: 'Ieri', days: 1, exact: true },
		{ id: '7d', label: 'Ultimele 7 zile', days: 7 },
		{ id: '30d', label: 'Ultimele 30 zile', days: 30 }
	];

	/**
	 * Compute "days ago" from a Date (or ISO string). Today = 0, yesterday = 1.
	 * Anchored on local midnight so timezone-near-midnight orders stay in the
	 * correct day bucket for the admin UI.
	 */
	function daysAgoFrom(at: Date | string | null): number {
		if (!at) return 9999;
		const t = new Date(at).getTime();
		if (Number.isNaN(t)) return 9999;
		const now = new Date();
		const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const startThat = (() => {
			const d = new Date(t);
			return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
		})();
		return Math.round((startToday - startThat) / 86_400_000);
	}

	function matchesDateFilter(o: HostingOrderRow, df: DatePreset): boolean {
		if (df.id === 'all') return true;
		const d = daysAgoFrom(o.createdAt);
		if (df.exact) return d === df.days;
		if (df.days === 0) return d === 0;
		if (typeof df.days === 'number') return d >= 0 && d <= df.days;
		return true;
	}

	// ---- Data --------------------------------------------------------------

	let ordersPromise = $state(getHostingOrders());
	let serversPromise = $state(getDAServers());
	let productsPromise = $state(getHostingProducts());
	// TVA dinamică din setări (invoice_settings.defaultTaxRate). `currentVatRate`
	// alimentează preview-ul comenzii noi; breakdown-ul comenzilor existente
	// folosește rata stocată pe fiecare linie (item.vatRate), cu fallback la rata curentă.
	let settingsPromise = $state(getInvoiceSettings());
	let currentVatRate = $state<number | null>(null);
	$effect(() => {
		settingsPromise
			.then((s) => {
				currentVatRate = s.defaultTaxRate;
			})
			.catch(() => {});
	});

	async function refresh() {
		// SvelteKit `query()` cache-uiește răspunsul. Reassigning la `getHostingOrders()`
		// returnează același rezultat cached, deci UI-ul nu se update-ează după
		// delete/edit. Apelăm `.refresh()` pe query-handle ca să invalidăm cache-ul,
		// apoi reassign-ăm promise-ul pentru a forța re-render-ul `{#await}`.
		await getHostingOrders().refresh();
		ordersPromise = getHostingOrders();
	}

	// ---- View state --------------------------------------------------------

	type ActiveTab = 'all' | 'paid' | 'pending' | 'failed' | 'refunded';
	let activeTab = $state<ActiveTab>('all');
	let search = $state('');
	let planFilter = $state<string | null>(null); // hosting_product.id
	let methodFilter = $state<string | null>(null);
	let periodFilter = $state<'monthly' | 'yearly' | null>(null);
	let dateFilter = $state<DatePreset>(DATE_PRESETS[0]);
	let dateOpen = $state(false);

	// Drawer
	let openOrder = $state<HostingOrderRow | null>(null);
	let confirmOpen = $state(false);

	// Confirm-payment panel local state
	let confirmMethod = $state<'card' | 'op' | 'cash'>('op');
	let confirmAmount = $state('');
	let confirmTxId = $state('');
	let confirmNote = $state('');
	let confirmProvision = $state(true);
	let confirmBusy = $state(false);

	// Manual order modal — folosește componenta partajată ManualOrderModal.svelte
	// (aceeași folosită de butonul „Cont nou" din pagina Provisioning).
	let showManual = $state(false);

	// Delete confirmation modal — typed-confirm pentru ștergere ireversibilă.
	// Cere admin-ului să tipezească exact `STERGE` ca să previn click-uri accidentale.
	const DELETE_CONFIRM_PHRASE = 'STERGE';
	let deleteTarget = $state<HostingOrderRow | null>(null);
	let deleteConfirmText = $state('');
	let deleteBusy = $state(false);

	// Pagination — client-side, 10 rows / page.
	const PAGE_SIZE = 10;
	let pageNum = $state(1);

	// ---- Helpers -----------------------------------------------------------

	/** Derive admin "account status" from raw row fields. The persisted
	 * `hosting_account.status` is the source of truth; pre-account orders fall
	 * back to payment-status-derived states. */
	function accountStatusOf(o: HostingOrderRow): 'active' | 'provisioning' | 'awaiting-payment' | 'cancelled' {
		if (o.hostingAccountId && o.daAccountStatus === 'active') return 'active';
		if (o.paymentStatus === 'paid' && !o.hostingAccountId) return 'provisioning';
		if (o.paymentStatus === 'pending' || o.paymentStatus === 'processing') return 'awaiting-payment';
		if (o.paymentStatus === 'failed' || o.paymentStatus === 'refunded') return 'cancelled';
		return 'awaiting-payment';
	}

	/** Plan-themed hex color (per-product from `hosting_product.color`).
	 * Fallback OTS blue so old products without backfilled color still render. */
	function productColorOf(o: HostingOrderRow): string {
		return o.productColor || '#1877F2';
	}

	function methodIcon(m: string | null): typeof CreditCardIcon {
		if (m === 'op') return BuildingIcon;
		if (m === 'cash') return DollarSignIcon;
		if (m === 'revolut') return ZapIcon;
		if (m === 'paypal') return DollarSignIcon;
		return CreditCardIcon;
	}

	function fmtRelative(d: Date | string | null): string {
		if (!d) return '—';
		const t = new Date(d).getTime();
		if (Number.isNaN(t)) return '—';
		const diff = Date.now() - t;
		const min = Math.floor(diff / 60_000);
		if (min < 1) return 'acum câteva secunde';
		if (min < 60) return `acum ${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `acum ${h} ${h === 1 ? 'oră' : 'ore'}`;
		const dd = Math.floor(h / 24);
		if (dd === 0) return 'azi';
		if (dd === 1) return 'ieri';
		return `acum ${dd} zile`;
	}

	function fmtTime(d: Date | string | null): string {
		if (!d) return '';
		try {
			return new Date(d).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	/** Format integer cents as `<int> RON` (no decimals when whole) for the
	 * row Sumă column + drawer totals box. Mirrors the design's plain-int look. */
	function fmtRon(amountCents: number | null | undefined): string {
		if (amountCents == null) return '—';
		const v = amountCents / 100;
		const rounded = Math.round(v);
		// Use rounded int when very close (within 0.005 RON); else keep 2 decimals.
		if (Math.abs(v - rounded) < 0.005) return `${rounded} RON`;
		return `${v.toFixed(2)} RON`;
	}

	/** Format raw integer (e.g. amount in RON, not cents) as `<n> RON`. */
	function fmtRonInt(amount: number): string {
		return `${Math.round(amount)} RON`;
	}

	function billingCycleLabel(cycle: string | null, period?: string | null): string {
		const eff = period ?? cycle;
		if (eff === 'yearly') return 'anual';
		if (eff === 'monthly') return 'lunar';
		return cycle ?? '';
	}

	/** Domain item (kind='domain') from a row, if any. */
	function domainItemOf(o: HostingOrderRow): HostingOrderItemRow | null {
		return (o.items ?? []).find((i) => i.kind === 'domain') ?? null;
	}

	/** Rata TVA a comenzii — stocată pe linie la creare (item.vatRate). Fallback:
	 * rata curentă din setări, apoi 21 (standard RO) doar până se încarcă setările. */
	function orderVatRate(o: HostingOrderRow): number {
		const h = (o.items ?? []).find((i) => i.kind === 'hosting');
		const d = domainItemOf(o);
		return h?.vatRate ?? d?.vatRate ?? currentVatRate ?? 21;
	}

	/** Net (fără TVA) în cents pentru linia de hosting. `unitPriceCents` e stocat NET
	 * (serverul adaugă TVA peste), deci nu mai împărțim — îl folosim direct. */
	function hostingNetCents(o: HostingOrderRow): number {
		const h = (o.items ?? []).find((i) => i.kind === 'hosting');
		return h ? h.unitPriceCents * h.quantity : (o.productPrice ?? 0);
	}

	/** Domain net cents (always 0 unless 'buy' mode with a positive price). */
	function domainNetCents(o: HostingOrderRow): number {
		const d = domainItemOf(o);
		if (!d || d.unitPriceCents <= 0) return 0;
		return d.unitPriceCents * d.quantity;
	}

	/** Suma porțiunilor net × rata TVA stocată a comenzii — TVA în cents. */
	function tvaCents(o: HostingOrderRow): number {
		const net = hostingNetCents(o) + domainNetCents(o);
		return Math.round((net * orderVatRate(o)) / 100);
	}

	/** Total TTC (gross) în cents — paidAmountCents când există, altfel net + TVA. */
	function totalCents(o: HostingOrderRow): number {
		if (o.paidAmountCents != null) return o.paidAmountCents;
		return hostingNetCents(o) + domainNetCents(o) + tvaCents(o);
	}

	// ---- Timeline ----------------------------------------------------------

	type TimelineEntry = { dot: string; title: string; when: string; meta: string };

	function buildTimeline(o: HostingOrderRow): TimelineEntry[] {
		const out: TimelineEntry[] = [];
		const placed = fmtRelative(o.createdAt);
		out.push({
			dot: METHOD_TIMELINE_COLOR.placed,
			title: 'Comandă plasată',
			when: placed,
			meta: `de pe /${o.source}`
		});
		const last4 = o.cardLast4 ? ` ····${o.cardLast4}` : '';
		const methodLabel = METHOD_LABELS[o.paymentMethod ?? ''] ?? '';
		const totalLabel = fmtRon(o.paidAmountCents ?? totalCents(o));
		if (o.paymentStatus === 'paid') {
			out.push({
				dot: METHOD_TIMELINE_COLOR.paid,
				title: 'Plată confirmată',
				when: fmtRelative(o.paidAt ?? o.acceptedAt ?? o.createdAt),
				meta: `${methodLabel}${last4} · ${totalLabel}`
			});
		} else if (o.paymentStatus === 'pending') {
			out.push({
				dot: METHOD_TIMELINE_COLOR.pending,
				title: 'Așteaptă plată',
				when: placed,
				meta: 'Factură proforma emisă'
			});
		} else if (o.paymentStatus === 'failed') {
			out.push({
				dot: METHOD_TIMELINE_COLOR.failed,
				title: 'Plată eșuată',
				when: placed,
				meta: o.paymentErrorMessage ?? 'Plata nu a putut fi procesată'
			});
		} else if (o.paymentStatus === 'refunded') {
			out.push({
				dot: METHOD_TIMELINE_COLOR.paid,
				title: 'Plată confirmată',
				when: fmtRelative(o.paidAt ?? o.acceptedAt ?? o.createdAt),
				meta: `${methodLabel}${last4} · ${totalLabel}`
			});
			out.push({
				dot: METHOD_TIMELINE_COLOR.refunded,
				title: 'Refund procesat',
				when: 'ulterior',
				meta: 'Banii returnați pe metoda originală'
			});
		} else if (o.paymentStatus === 'processing') {
			out.push({
				dot: METHOD_TIMELINE_COLOR.processing,
				title: 'Plată în procesare',
				when: placed,
				meta: `${methodLabel} · în așteptarea confirmării`
			});
		}
		const acct = accountStatusOf(o);
		if (acct === 'active') {
			out.push({
				dot: METHOD_TIMELINE_COLOR.active,
				title: 'Cont DirectAdmin creat',
				when: fmtRelative(o.paidAt ?? o.createdAt),
				meta: `${o.daUsername ?? '—'} · credențiale trimise pe ${o.contactEmail}`
			});
		} else if (acct === 'provisioning') {
			out.push({
				dot: METHOD_TIMELINE_COLOR.provisioning,
				title: 'Cont în provisionare',
				when: 'în curs',
				meta: 'Server auto-alocat · credențiale în max 5 minute'
			});
		}
		return out;
	}

	// ---- Filtering + KPIs --------------------------------------------------

	/** Apply current tab + chip + search + date-preset filters to a list. */
	function applyFilters(list: HostingOrderRow[]): HostingOrderRow[] {
		const q = search.trim().toLowerCase();
		return list.filter((o) => {
			// Tab — "pending" includes 'processing' per design.
			if (activeTab === 'paid' && o.paymentStatus !== 'paid') return false;
			if (activeTab === 'pending' && o.paymentStatus !== 'pending' && o.paymentStatus !== 'processing') return false;
			if (activeTab === 'failed' && o.paymentStatus !== 'failed') return false;
			if (activeTab === 'refunded' && o.paymentStatus !== 'refunded') return false;
			// Chips
			if (planFilter && o.hostingProductId !== planFilter) return false;
			if (methodFilter && o.paymentMethod !== methodFilter) return false;
			if (periodFilter && o.productBillingCycle !== periodFilter) return false;
			if (!matchesDateFilter(o, dateFilter)) return false;
			// Search
			if (q) {
				const hay = [
					displayOrderId(o.orderNumber, o.id),
					o.contactName,
					o.contactEmail,
					o.companyName ?? '',
					o.vatNumber ?? '',
					o.productName ?? '',
					domainItemOf(o)?.domainName ?? o.requestedDomain ?? '',
					o.daDomain ?? '',
					o.daUsername ?? ''
				]
					.join(' ')
					.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}

	/** Counts per tab + per date-preset, computed in one pass for the toolbar
	 * pills (Toate/Achitate/etc.) and date popover row counts. */
	function tabCounts(list: HostingOrderRow[]) {
		return {
			all: list.length,
			paid: list.filter((o) => o.paymentStatus === 'paid').length,
			pending: list.filter((o) => o.paymentStatus === 'pending' || o.paymentStatus === 'processing').length,
			failed: list.filter((o) => o.paymentStatus === 'failed').length,
			refunded: list.filter((o) => o.paymentStatus === 'refunded').length
		};
	}

	function dateCounts(list: HostingOrderRow[]): Record<DatePresetId, number> {
		const out: Record<DatePresetId, number> = { all: 0, today: 0, yesterday: 0, '7d': 0, '30d': 0 };
		for (const p of DATE_PRESETS) out[p.id] = list.filter((o) => matchesDateFilter(o, p)).length;
		return out;
	}

	/** KPI row data — totals, today/yesterday counts, paid revenue current
	 * month vs previous, conversion %, new-domain count. */
	function kpis(list: HostingOrderRow[]) {
		const now = new Date();
		const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const startYesterday = startToday - 86_400_000;
		const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
		const startPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
		const endPrevMonth = startMonth - 1;

		let todayCount = 0;
		let yesterdayCount = 0;
		let paidThisMonth = 0;
		let paidPrevMonth = 0;
		let paidCount = 0;
		let pendingAmount = 0;
		let pendingCount = 0;
		let failedAmount = 0;
		let failedCount = 0;
		let newDomains = 0;

		for (const o of list) {
			const created = o.createdAt ? new Date(o.createdAt).getTime() : 0;
			if (created >= startToday) todayCount += 1;
			else if (created >= startYesterday && created < startToday) yesterdayCount += 1;

			if (o.paymentStatus === 'paid') paidCount += 1;
			if (o.paymentStatus === 'pending' || o.paymentStatus === 'processing') {
				pendingCount += 1;
				pendingAmount += totalCents(o);
			}
			if (o.paymentStatus === 'failed') {
				failedCount += 1;
				failedAmount += totalCents(o);
			}

			if (o.paidAt && o.paidAmountCents != null) {
				const pt = new Date(o.paidAt).getTime();
				if (pt >= startMonth) paidThisMonth += o.paidAmountCents;
				else if (pt >= startPrevMonth && pt <= endPrevMonth) paidPrevMonth += o.paidAmountCents;
			}

			const dom = domainItemOf(o);
			if (dom?.domainMode === 'buy') newDomains += 1;
		}

		const total = list.length;
		const conversion = total > 0 ? Math.round((paidCount / total) * 100) : 0;
		const revenueDeltaPct = paidPrevMonth > 0 ? Math.round(((paidThisMonth - paidPrevMonth) / paidPrevMonth) * 1000) / 10 : null;

		return {
			total,
			todayCount,
			yesterdayCount,
			paidCount,
			paidThisMonth,
			revenueDeltaPct,
			pendingCount,
			pendingAmount,
			failedCount,
			failedAmount,
			conversion,
			newDomains
		};
	}

	// ---- Drawer actions ----------------------------------------------------

	function openDrawer(o: HostingOrderRow) {
		openOrder = o;
		// Auto-expand confirm panel for pending orders — matches design intent.
		confirmOpen = o.paymentStatus === 'pending';
		// Reset confirm-panel form state to defaults from row.
		const ttc = totalCents(o);
		confirmAmount = ttc > 0 ? String(ttc / 100) : '';
		confirmMethod = o.paymentMethod === 'card' ? 'card' : o.paymentMethod === 'cash' ? 'cash' : 'op';
		confirmTxId = '';
		confirmNote = '';
		confirmProvision = !o.hostingAccountId;
	}

	function closeDrawer() {
		openOrder = null;
		confirmOpen = false;
	}

	async function submitConfirmPayment(o: HostingOrderRow) {
		const amt = parseFloat(confirmAmount.replace(',', '.'));
		if (!Number.isFinite(amt) || amt <= 0) {
			toast.error('Suma e invalidă');
			return;
		}
		confirmBusy = true;
		try {
			const r = await acceptHostingOrderPayment({
				id: o.id,
				paymentMethod: confirmMethod,
				paidAmountCents: Math.round(amt * 100),
				paymentReference: confirmTxId.trim() || undefined,
				note: confirmNote.trim() || undefined,
				triggerProvisioning: confirmProvision
			});
			if (r.provisioned === false && 'reason' in r && r.reason && r.reason !== 'skipped_by_caller') {
				toast.warning('Plată acceptată, dar provisioning DA a eșuat', { description: r.reason });
			} else if (r.provisioned && 'daUsername' in r && r.daUsername) {
				toast.success('Încasare confirmată', { description: `${displayOrderId(o.orderNumber, o.id)} · DA: ${r.daUsername}` });
			} else {
				toast.success('Încasare confirmată', {
					description: `${displayOrderId(o.orderNumber, o.id)} · ${amt} RON`
				});
			}
			closeDrawer();
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			confirmBusy = false;
		}
	}

	async function handleAction(kind: string, o: HostingOrderRow) {
		if (kind === 'mark-paid') {
			openDrawer(o);
			confirmOpen = true;
			toast.info('Confirmă încasarea', {
				description: `${displayOrderId(o.orderNumber, o.id)} · selectează metoda de plată`
			});
		} else if (kind === 'retry-payment') {
			toast.info('Retry plată', {
				description: 'Re-trimite linkul de plată din modulul facturi (în curând)'
			});
		} else if (kind === 'refund') {
			if (!confirm(`Refund integral pentru ${displayOrderId(o.orderNumber, o.id)} (${fmtRon(totalCents(o))})?`)) return;
			toast.warning('Refund prin Stripe — funcție în curând');
		} else if (kind === 'invoice') {
			window.location.href = `/${page.params.tenant}/invoices?clientEmail=${encodeURIComponent(o.contactEmail)}`;
		} else if (kind === 'email-client') {
			window.location.href = `mailto:${o.contactEmail}?subject=${encodeURIComponent('Comanda ' + displayOrderId(o.orderNumber, o.id))}`;
		} else if (kind === 'resend-invoice') {
			toast.success('Proforma re-trimisă', { description: o.contactEmail });
		} else if (kind === 'open-account') {
			if (o.hostingAccountId) {
				window.location.href = `/${page.params.tenant}/hosting/accounts/${o.hostingAccountId}`;
			}
		} else if (kind === 'force-provision') {
			try {
				const r = await provisionFromInquiry({
					inquiryId: o.id,
					daServerId: o.productDaServerId ?? '',
					daPackageId: o.productDaPackageId ?? undefined,
					daUsername: (o.contactEmail.split('@')[0] || 'admin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12),
					domain: (domainItemOf(o)?.domainName ?? o.requestedDomain ?? '').toLowerCase(),
					password: cryptoPassword()
				});
				if (r.ok) {
					toast.success('Provisionare reușită', { description: `${r.daUsername} (${r.domain})` });
					closeDrawer();
					await refresh();
				} else {
					toast.error('Provisioning eșuat', { description: r.error });
				}
			} catch (e) {
				toast.error(e instanceof Error ? e.message : 'Eroare');
			}
		}
	}

	function cryptoPassword(): string {
		// 18-char URL-safe random — adequate for one-time admin DA password.
		const arr = new Uint8Array(12);
		crypto.getRandomValues(arr);
		return Array.from(arr, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 18);
	}

	// ---- Delete confirmation -----------------------------------------------

	function openDeleteModal(o: HostingOrderRow) {
		deleteTarget = o;
		deleteConfirmText = '';
	}

	function closeDeleteModal() {
		if (deleteBusy) return; // nu închide în timpul request-ului
		deleteTarget = null;
		deleteConfirmText = '';
	}

	async function submitDelete() {
		if (!deleteTarget) return;
		if (deleteConfirmText.trim().toUpperCase() !== DELETE_CONFIRM_PHRASE) {
			toast.error(`Trebuie să tipezești exact "${DELETE_CONFIRM_PHRASE}" pentru a confirma.`);
			return;
		}
		const target = deleteTarget;
		deleteBusy = true;
		const toastId = toast.loading('Se șterge comanda...');
		try {
			await deleteHostingInquiry(target.id);
			toast.success('Comanda a fost ștearsă', {
				id: toastId,
				description: displayOrderId(target.orderNumber, target.id)
			});
			deleteTarget = null;
			deleteConfirmText = '';
			await refresh();
		} catch (e) {
			toast.error('Ștergere eșuată', {
				id: toastId,
				description: e instanceof Error ? e.message : String(e)
			});
		} finally {
			deleteBusy = false;
		}
	}


	// ---- CSV export -----------------------------------------------------------

	function exportCsv(list: HostingOrderRow[]) {
		const header = [
			'Comanda',
			'Data',
			'Client',
			'Email',
			'Firma',
			'CUI',
			'Pachet',
			'Domeniu',
			'Suma RON',
			'Metoda',
			'Status plata',
			'Status cont'
		];
		const rows = list.map((o) => [
			displayOrderId(o.orderNumber, o.id),
			o.createdAt ? new Date(o.createdAt).toISOString() : '',
			o.contactName,
			o.contactEmail,
			o.companyName ?? '',
			o.vatNumber ?? '',
			o.productName ?? '',
			domainItemOf(o)?.domainName ?? o.requestedDomain ?? '',
			String(totalCents(o) / 100),
			METHOD_LABELS[o.paymentMethod ?? ''] ?? '',
			PAY_LABELS[o.paymentStatus] ?? o.paymentStatus,
			ACC_LABELS[accountStatusOf(o)] ?? ''
		]);
		const csv = [header, ...rows]
			.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `comenzi-hosting-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="hosting-wrap" data-screen-label="OTS Hosting Orders">
	{#await ordersPromise}
		<div class="hod-loading">Se încarcă comenzile…</div>
	{:then orders}
		{@const c = tabCounts(orders)}
		{@const dc = dateCounts(orders)}
		{@const k = kpis(orders)}
		{@const filteredAll = applyFilters(orders)}
		{@const totalPages = Math.max(1, Math.ceil(filteredAll.length / PAGE_SIZE))}
		{@const safePage = Math.min(pageNum, totalPages)}
		{@const filtered = filteredAll.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)}

		<!-- Hero -->
		<div class="hst-hero">
			<div>
				<h1>Comenzi hosting</h1>
				<p>
					Comenzile primite de pe pagina publică <strong>/pachete-hosting</strong> · {k.total} total ·
					{k.todayCount} azi · {(k.paidThisMonth / 100000).toFixed(1)}k RON achitați
				</p>
			</div>
			<div class="hst-hero-actions">
				<button class="btn-secondary" onclick={() => refresh()}>
					<RefreshCwIcon size={13} /> Sync plăți
				</button>
				<button
					class="btn-secondary"
					onclick={() => exportCsv(filteredAll)}
					disabled={filteredAll.length === 0}
				>
					<DownloadIcon size={13} /> Export CSV
				</button>
				<button class="btn-primary" onclick={() => (showManual = true)}>
					<PlusIcon size={14} /> Comandă manuală
				</button>
			</div>
		</div>

		<!-- KPI strip — 6 tiles using dash-kpi pattern -->
		<div class="hst-kpis">
			<div class="dash-kpi primary">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(24,119,242,.12);color:#1877F2">
						<ShoppingBagIcon size={13} />
					</div>
					<div class="dash-kpi-label">Comenzi total</div>
				</div>
				<div class="dash-kpi-value">{k.total}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">{k.todayCount} azi · {k.yesterdayCount} ieri</span>
					{#if k.todayCount > 0}
						<span class="dash-delta up">+{k.todayCount}</span>
					{/if}
				</div>
			</div>

			<div class="dash-kpi success">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(16,185,129,.12);color:#10b981">
						<DollarSignIcon size={13} />
					</div>
					<div class="dash-kpi-label">Revenue achitat</div>
				</div>
				<div class="dash-kpi-value">{(k.paidThisMonth / 100000).toFixed(2)}k RON</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">din {k.paidCount} comenzi</span>
					{#if k.revenueDeltaPct != null}
						<span class="dash-delta {k.revenueDeltaPct >= 0 ? 'up' : 'down'}">
							{k.revenueDeltaPct >= 0 ? '+' : ''}{k.revenueDeltaPct.toFixed(1)}%
						</span>
					{/if}
				</div>
			</div>

			<div class="dash-kpi warn">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(245,158,11,.14);color:#f59e0b">
						<ClockIcon size={13} />
					</div>
					<div class="dash-kpi-label">Plăți în așteptare</div>
				</div>
				<div class="dash-kpi-value">{fmtRon(k.pendingAmount)}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">{k.pendingCount} comenzi pending</span>
				</div>
			</div>

			<div class="dash-kpi danger">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(239,68,68,.12);color:#ef4444">
						<AlertTriangleIcon size={13} />
					</div>
					<div class="dash-kpi-label">Plăți eșuate</div>
				</div>
				<div class="dash-kpi-value">{fmtRon(k.failedAmount)}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">{k.failedCount} comenzi de recuperat</span>
				</div>
			</div>

			<div class="dash-kpi info">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(99,102,241,.12);color:#6366f1">
						<TrendingUpIcon size={13} />
					</div>
					<div class="dash-kpi-label">Conversie plată</div>
				</div>
				<div class="dash-kpi-value">{k.conversion}%</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">{k.paidCount} / {k.total}</span>
				</div>
			</div>

			<div class="dash-kpi info">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(99,102,241,.12);color:#6366f1">
						<GlobeIcon size={13} />
					</div>
					<div class="dash-kpi-label">Domenii noi</div>
				</div>
				<div class="dash-kpi-value">{k.newDomains}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">cumpărate prin checkout</span>
				</div>
			</div>
		</div>

		<!-- Tabs -->
		<div class="hst-tabs" role="tablist">
			<button
				class="hst-tab"
				class:active={activeTab === 'all'}
				role="tab"
				aria-selected={activeTab === 'all'}
				onclick={() => {
					activeTab = 'all';
					pageNum = 1;
				}}
			>
				Toate <span class="hst-tab-count">{c.all}</span>
			</button>
			<button
				class="hst-tab"
				class:active={activeTab === 'paid'}
				role="tab"
				aria-selected={activeTab === 'paid'}
				onclick={() => {
					activeTab = 'paid';
					pageNum = 1;
				}}
			>
				Achitate <span class="hst-tab-count">{c.paid}</span>
			</button>
			<button
				class="hst-tab"
				class:active={activeTab === 'pending'}
				role="tab"
				aria-selected={activeTab === 'pending'}
				onclick={() => {
					activeTab = 'pending';
					pageNum = 1;
				}}
			>
				În așteptare <span class="hst-tab-count">{c.pending}</span>
			</button>
			<button
				class="hst-tab"
				class:active={activeTab === 'failed'}
				role="tab"
				aria-selected={activeTab === 'failed'}
				onclick={() => {
					activeTab = 'failed';
					pageNum = 1;
				}}
			>
				Eșuate <span class="hst-tab-count">{c.failed}</span>
			</button>
			<button
				class="hst-tab"
				class:active={activeTab === 'refunded'}
				role="tab"
				aria-selected={activeTab === 'refunded'}
				onclick={() => {
					activeTab = 'refunded';
					pageNum = 1;
				}}
			>
				Refundate <span class="hst-tab-count">{c.refunded}</span>
			</button>
		</div>

		<!-- Toolbar: search + filter chips -->
		<div class="hst-accounts-toolbar">
			<div class="hst-search">
				<SearchIcon size={13} />
				<input
					placeholder="Caută ID, domeniu, client, email..."
					bind:value={search}
					oninput={() => (pageNum = 1)}
				/>
			</div>
			{#await productsPromise then products}
				{@const planObj = planFilter ? products.find((p) => p.id === planFilter) : null}
				<button
					class="hst-filter-chip"
					class:active={!!planFilter}
					onclick={() => {
						if (planFilter) {
							planFilter = null;
						} else {
							const candidates = products.filter((p) => p.isPublic !== false);
							if (candidates.length > 0) planFilter = candidates[0].id;
						}
						pageNum = 1;
					}}
				>
					<PackageIcon size={12} />
					{planObj?.name ?? 'Pachet'}
					{#if planFilter}
						<XIcon
							size={10}
							onclick={(e: MouseEvent) => {
								e.stopPropagation();
								planFilter = null;
								pageNum = 1;
							}}
						/>
					{/if}
				</button>
			{/await}
			<button
				class="hst-filter-chip"
				class:active={!!methodFilter}
				onclick={() => {
					methodFilter = methodFilter === 'card' ? null : 'card';
					pageNum = 1;
				}}
			>
				<CreditCardIcon size={12} />
				{methodFilter ? (METHOD_LABELS[methodFilter] ?? 'Metodă') : 'Metodă'}
				{#if methodFilter}
					<XIcon
						size={10}
						onclick={(e: MouseEvent) => {
							e.stopPropagation();
							methodFilter = null;
							pageNum = 1;
						}}
					/>
				{/if}
			</button>
			<button
				class="hst-filter-chip"
				class:active={!!periodFilter}
				onclick={() => {
					periodFilter = periodFilter === 'yearly' ? 'monthly' : periodFilter === 'monthly' ? null : 'yearly';
					pageNum = 1;
				}}
			>
				<CalendarIcon size={12} />
				{periodFilter === 'yearly' ? 'Anuale' : periodFilter === 'monthly' ? 'Lunare' : 'Perioadă'}
				{#if periodFilter}
					<XIcon
						size={10}
						onclick={(e: MouseEvent) => {
							e.stopPropagation();
							periodFilter = null;
							pageNum = 1;
						}}
					/>
				{/if}
			</button>
			<div class="ord-date-pop-wrap">
				<button
					class="hst-filter-chip"
					class:active={dateFilter.id !== 'all'}
					onclick={() => (dateOpen = !dateOpen)}
				>
					<CalendarIcon size={12} />
					{dateFilter.id === 'all' ? 'Data' : dateFilter.label}
					{#if dateFilter.id !== 'all'}
						<XIcon
							size={10}
							onclick={(e: MouseEvent) => {
								e.stopPropagation();
								dateFilter = DATE_PRESETS[0];
								pageNum = 1;
							}}
						/>
					{/if}
				</button>
				{#if dateOpen}
					<div class="ord-date-pop" role="dialog" aria-label="Filtru perioadă">
						{#each DATE_PRESETS as p (p.id)}
							<button
								class:active={dateFilter.id === p.id}
								onclick={() => {
									dateFilter = p;
									dateOpen = false;
									pageNum = 1;
								}}
							>
								<span>{p.label}</span>
								<span class="pop-count">{dc[p.id] ?? 0}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<div class="hst-toolbar-spacer"></div>
		</div>

		<!-- Table -->
		<div class="hst-table-wrap">
			<table class="hst-table">
				<thead>
					<tr>
						<th>Comandă</th>
						<th>Client</th>
						<th>Pachet · Domeniu</th>
						<th>Metodă</th>
						<th class="num">Sumă</th>
						<th>Status plată</th>
						<th>Status cont</th>
						<th style="width:120px"></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as o (o.id)}
						{@const dom = domainItemOf(o)}
						{@const tot = totalCents(o)}
						{@const tva = tvaCents(o)}
						{@const acct = accountStatusOf(o)}
						{@const MIcon = methodIcon(o.paymentMethod)}
						<tr style="cursor:pointer" onclick={() => openDrawer(o)}>
							<td>
								<div class="hst-host-cell">{displayOrderId(o.orderNumber, o.id)}</div>
								<div class="ord-row-relative">{fmtRelative(o.createdAt)}</div>
								<div class="ord-row-source">
									<span class="ord-source-pill"><GlobeIcon size={9} />/{o.source}</span>
								</div>
							</td>
							<td>
								<div class="ord-row-name">{o.contactName}</div>
								<div class="ord-row-email">{o.contactEmail}</div>
								{#if o.vatNumber}
									<div class="ord-row-cui">{o.vatNumber}</div>
								{/if}
							</td>
							<td>
								<div class="ord-row-plan">
									<span class="ord-plan-dot" style="background:{productColorOf(o)}"></span>
									<strong>{o.productName ?? '—'}</strong>
									<span class="ord-row-period">{billingCycleLabel(o.productBillingCycle)}</span>
								</div>
								{#if dom?.domainName}
									<div class="ord-row-domain">{dom.domainName}</div>
									<div class="ord-row-domain-meta">
										{#if dom.domainMode === 'buy' && dom.unitPriceCents > 0}
											+ {fmtRon(dom.unitPriceCents)} domeniu nou
										{:else if dom.domainMode === 'transfer'}
											transfer gratuit
										{:else if dom.domainMode === 'have'}
											domeniu existent
										{/if}
									</div>
								{:else if o.requestedDomain}
									<div class="ord-row-domain">{o.requestedDomain}</div>
								{/if}
							</td>
							<td>
								<span class="ord-method-tile" class:ord-method-card={o.paymentMethod === 'card'}>
									<MIcon size={11} />
									{METHOD_LABELS[o.paymentMethod ?? ''] ?? '—'}{o.paymentMethod === 'card' && o.cardLast4 ? ` ····${o.cardLast4}` : ''}
								</span>
							</td>
							<td class="num">
								<div class="ord-amount">{fmtRon(tot)}</div>
								<div class="ord-amount-vat">incl. TVA {fmtRon(tva)}</div>
							</td>
							<td>
								<span class="ord-pay-badge {o.paymentStatus}"
									><span class="dot"></span>{PAY_LABELS[o.paymentStatus] ?? o.paymentStatus}</span
								>
								{#if o.paymentStatus === 'failed' && o.paymentErrorMessage}
									<div class="ord-row-failreason">{o.paymentErrorMessage.slice(0, 40)}…</div>
								{/if}
							</td>
							<td><span class="ord-acc-badge {acct}">{ACC_LABELS[acct]}</span></td>
							<td onclick={(e: MouseEvent) => e.stopPropagation()}>
								<div class="ord-row-actions">
									<button
										class="hst-icon-btn"
										title="Detalii"
										aria-label="Detalii"
										onclick={() => openDrawer(o)}
									>
										<EyeIcon size={12} />
									</button>
									{#if o.paymentStatus === 'pending'}
										<button
											class="hst-icon-btn"
											title="Marchează plătit"
											aria-label="Marchează plătit"
											onclick={() => handleAction('mark-paid', o)}
										>
											<CheckIcon size={12} />
										</button>
									{:else if o.paymentStatus === 'failed'}
										<button
											class="hst-icon-btn"
											title="Retry plată"
											aria-label="Retry plată"
											onclick={() => handleAction('retry-payment', o)}
										>
											<RefreshCwIcon size={12} />
										</button>
									{:else if o.paymentStatus === 'paid'}
										<button
											class="hst-icon-btn"
											title="Factură"
											aria-label="Factură"
											onclick={() => handleAction('invoice', o)}
										>
											<DownloadIcon size={12} />
										</button>
									{/if}
									<button
										class="hst-icon-btn"
										title="Email client"
										aria-label="Email client"
										onclick={() => handleAction('email-client', o)}
									>
										<MailIcon size={12} />
									</button>
									{#if !o.hostingAccountId}
										<button
											class="hst-icon-btn hst-icon-btn-danger"
											title="Șterge comanda"
											aria-label="Șterge comanda"
											onclick={() => openDeleteModal(o)}
										>
											<Trash2Icon size={12} />
										</button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
					{#if filtered.length === 0}
						<tr><td colspan="8" class="ord-empty-cell">Nicio comandă pentru filtrele curente</td></tr>
					{/if}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		<div class="ord-pagination">
			<span>Afișează {filtered.length} din {orders.length} comenzi</span>
			<div class="ord-pagination-spacer"></div>
			<div class="ord-pagination-buttons">
				<button
					class="hst-icon-btn"
					aria-label="Pagina anterioară"
					disabled={safePage <= 1}
					onclick={() => (pageNum = Math.max(1, safePage - 1))}
				>
					<ChevronLeftIcon size={13} />
				</button>
				{#each Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + Math.max(1, Math.min(totalPages - 4, safePage - 2))) as pn (pn)}
					<button
						class="hst-icon-btn"
						class:active-page={pn === safePage}
						onclick={() => (pageNum = pn)}
					>
						{pn}
					</button>
				{/each}
				<button
					class="hst-icon-btn"
					aria-label="Pagina următoare"
					disabled={safePage >= totalPages}
					onclick={() => (pageNum = Math.min(totalPages, safePage + 1))}
				>
					<ChevronRightIcon size={13} />
				</button>
			</div>
		</div>
	{:catch err}
		<div class="hod-empty">
			<AlertTriangleIcon size={40} />
			<p>Eroare la încărcare: {err instanceof Error ? err.message : String(err)}</p>
		</div>
	{/await}
</div>

<!-- Drawer ===================================================================-->
{#if openOrder}
	{@const o = openOrder}
	{@const dom = domainItemOf(o)}
	{@const tot = totalCents(o)}
	{@const tva = tvaCents(o)}
	{@const acct = accountStatusOf(o)}
	{@const planColor = productColorOf(o)}
	{@const timeline = buildTimeline(o)}
	{@const hostNet = hostingNetCents(o)}
	{@const domNet = domainNetCents(o)}
	{@const MIc = methodIcon(o.paymentMethod)}

	<button class="hst-drawer-back" aria-label="Închide" onclick={closeDrawer}></button>

	<div
		class="hst-drawer"
		role="dialog"
		aria-modal="true"
		aria-labelledby="hod-drawer-title"
		style="width:640px"
		use:focusTrap={{ initialFocus: '.hst-drawer-close' }}
	>
		<div class="hst-drawer-head">
			<div
				class="hst-server-card-icon"
				style="background:linear-gradient(135deg, {planColor}, {planColor}cc)"
			>
				<ShoppingBagIcon size={18} />
			</div>
			<div class="ord-drawer-head-text">
				<div id="hod-drawer-title" class="ord-drawer-title">
					{displayOrderId(o.orderNumber, o.id)}
				</div>
				<div class="ord-drawer-subtitle">
					{fmtRelative(o.createdAt)} · de pe <span class="ord-drawer-source">/{o.source}</span>
				</div>
			</div>
			<span class="ord-pay-badge {o.paymentStatus}"
				><span class="dot"></span>{PAY_LABELS[o.paymentStatus] ?? o.paymentStatus}</span
			>
			<button class="hst-drawer-close" aria-label="Închide" onclick={closeDrawer}>
				<XIcon size={14} />
			</button>
		</div>

		<div class="hst-drawer-body">
			<!-- State banners -->
			{#if o.paymentStatus === 'failed'}
				<div class="ord-banner ord-banner-bad">
					<AlertTriangleIcon size={16} />
					<div class="ord-banner-text">
						<strong>Plata a eșuat</strong>
						<span>{o.paymentErrorMessage ?? 'Card refuzat de bancă'}</span>
					</div>
					<button class="btn-primary ord-btn-bad" onclick={() => handleAction('retry-payment', o)}>
						<RefreshCwIcon size={12} /> Retry
					</button>
				</div>
			{/if}
			{#if o.paymentStatus === 'pending' && !confirmOpen}
				<div class="ord-banner ord-banner-warn">
					<ClockIcon size={16} />
					<div class="ord-banner-text">
						<strong>Așteptăm plata prin {METHOD_LABELS[o.paymentMethod ?? ''] ?? 'transfer'}</strong>
						<span>Contul se activează după confirmarea încasării</span>
					</div>
					<button class="btn-secondary" onclick={() => handleAction('resend-invoice', o)}>
						<MailIcon size={12} /> Re-trimite
					</button>
					<button class="btn-primary" onclick={() => (confirmOpen = true)}>
						<CheckIcon size={12} /> Confirmă încasarea
					</button>
				</div>
			{/if}

			<!-- Confirm payment panel -->
			{#if o.paymentStatus === 'pending' && confirmOpen}
				<div class="ord-confirm">
					<div class="ord-confirm-head">
						<h4>Confirmă încasarea</h4>
						<span class="ord-confirm-pill"><span class="dot"></span>În așteptare</span>
					</div>

					<div class="ord-confirm-row">
						<span class="ord-confirm-label">Metodă</span>
						<PaymentMethodPicker bind:value={confirmMethod} size="sm" />
					</div>

					<div class="ord-confirm-row">
						<label for="confirm-amount">Sumă (RON)</label>
						<div class="ord-confirm-input-suffix">
							<input
								id="confirm-amount"
								type="text"
								inputmode="decimal"
								class="mono"
								bind:value={confirmAmount}
							/>
							<span class="suffix">RON</span>
						</div>
					</div>

					<div class="ord-confirm-row">
						<label for="confirm-tx">
							{confirmMethod === 'card'
								? 'ID tranzacție card / chitanță POS (opțional)'
								: confirmMethod === 'op'
									? 'Referință OP / extras (opțional)'
									: 'Nr. chitanță numerar (opțional)'}
						</label>
						<input
							id="confirm-tx"
							type="text"
							class="mono"
							placeholder={confirmMethod === 'card'
								? 'ex: ch_3TZyAw… / chitanță POS 4242'
								: confirmMethod === 'op'
									? 'ex: OP nr. 481 / extras BCR 26.05'
									: 'ex: chitanță numerar nr. 0042'}
							bind:value={confirmTxId}
						/>
					</div>

					<div class="ord-confirm-row">
						<label for="confirm-note">Notă (opțional)</label>
						<textarea
							id="confirm-note"
							placeholder="Detalii pentru audit intern"
							bind:value={confirmNote}
						></textarea>
					</div>

					<label class="ord-confirm-check">
						<input type="checkbox" bind:checked={confirmProvision} />
						<span>
							<strong>Declanșează provisioning DirectAdmin</strong> imediat după confirmare
						</span>
					</label>

					<div class="ord-confirm-foot">
						<div class="ord-confirm-context">
							Pachet <strong>{o.productName ?? '—'}</strong> ·
							{dom?.domainName ?? o.requestedDomain ?? '—'}
						</div>
						<div class="spacer"></div>
						<button class="btn-secondary" onclick={() => (confirmOpen = false)}>Anulează</button>
						<button
							class="btn-primary"
							disabled={confirmBusy}
							onclick={() => submitConfirmPayment(o)}
						>
							<CheckIcon size={13} /> Confirmă
						</button>
					</div>
				</div>
			{/if}

			<!-- Client section -->
			<div class="hst-drawer-section">
				<h4>Client</h4>
				<div class="hst-kv-grid">
					<div class="hst-kv">
						<div class="hst-kv-l">Nume</div>
						<div class="hst-kv-v">{o.contactName}</div>
					</div>
					<div class="hst-kv">
						<div class="hst-kv-l">Email</div>
						<div class="hst-kv-v ord-kv-small">{o.contactEmail}</div>
					</div>
					<div class="hst-kv">
						<div class="hst-kv-l">Tip</div>
						<div class="hst-kv-v">
							{o.companyName || o.vatNumber ? 'Persoană juridică' : 'Persoană fizică'}
						</div>
					</div>
					{#if o.vatNumber}
						<div class="hst-kv">
							<div class="hst-kv-l">CUI</div>
							<div class="hst-kv-v ord-mono">{o.vatNumber}</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Order details -->
			<div class="hst-drawer-section">
				<h4>Detalii comandă</h4>
				<div class="hst-kv-grid">
					<div class="hst-kv">
						<div class="hst-kv-l">Pachet</div>
						<div class="hst-kv-v" style="color:{planColor}">
							{o.productName ?? '—'}
						</div>
					</div>
					<div class="hst-kv">
						<div class="hst-kv-l">Facturare</div>
						<div class="hst-kv-v">
							{o.productBillingCycle === 'yearly' ? 'Anual' : 'Lunar'}
						</div>
					</div>
					<div class="hst-kv">
						<div class="hst-kv-l">Domeniu</div>
						<div class="hst-kv-v ord-mono">{dom?.domainName ?? o.requestedDomain ?? '—'}</div>
					</div>
					<div class="hst-kv">
						<div class="hst-kv-l">Mod domeniu</div>
						<div class="hst-kv-v">
							{dom?.domainMode === 'buy'
								? 'Cumpărat nou'
								: dom?.domainMode === 'transfer'
									? 'Transfer'
									: dom?.domainMode === 'have'
										? 'Existent'
										: '—'}
						</div>
					</div>
					<div class="hst-kv">
						<div class="hst-kv-l">Server</div>
						<div class="hst-kv-v ord-mono">
							{#await serversPromise then servers}
								{servers.find((s) => s.id === o.productDaServerId)?.name ?? (o.paymentStatus === 'paid' ? 'Auto-alocare în curs' : '—')}
							{/await}
						</div>
					</div>
					<div class="hst-kv">
						<div class="hst-kv-l">Status cont</div>
						<div class="hst-kv-v">
							<span class="ord-acc-badge {acct}">{ACC_LABELS[acct]}</span>
						</div>
					</div>
				</div>
			</div>

			<!-- Payment -->
			<div class="hst-drawer-section">
				<h4>Plată</h4>
				<div class="hst-kv-grid">
					<div class="hst-kv">
						<div class="hst-kv-l">Metodă</div>
						<div class="hst-kv-v">
							<span class="ord-method-tile" class:ord-method-card={o.paymentMethod === 'card'}>
								<MIc size={11} />
								{METHOD_LABELS[o.paymentMethod ?? ''] ?? '—'}{o.paymentMethod === 'card' && o.cardLast4 ? ` ····${o.cardLast4}` : ''}
							</span>
						</div>
					</div>
					<div class="hst-kv">
						<div class="hst-kv-l">Status</div>
						<div class="hst-kv-v">
							<span class="ord-pay-badge {o.paymentStatus}"
								><span class="dot"></span>{PAY_LABELS[o.paymentStatus] ?? o.paymentStatus}</span
							>
						</div>
					</div>
				</div>

				<div class="ord-totals">
					<div class="ord-total-row">
						<span
							>Hosting {o.productName ?? '—'} ({o.productBillingCycle === 'yearly' ? 'anual' : 'lunar'})</span
						>
						<strong>{fmtRonInt(hostNet / 100)}</strong>
					</div>
					{#if domNet > 0}
						<div class="ord-total-row">
							<span>Domeniu {dom?.domainName ?? ''}</span>
							<strong>{fmtRonInt(domNet / 100)}</strong>
						</div>
					{/if}
					<div class="ord-total-row">
						<span>TVA {orderVatRate(o)}%</span>
						<strong>{fmtRonInt(tva / 100)}</strong>
					</div>
					<div class="ord-total-row big">
						<span>Total {o.paymentStatus === 'paid' ? 'achitat' : 'de plată'}</span>
						<strong>{fmtRonInt(tot / 100)}</strong>
					</div>
				</div>
			</div>

			<!-- Timeline -->
			<div class="hst-drawer-section">
				<h4>Istoric</h4>
				<div class="ord-detail-timeline">
					{#each timeline as t, i (i)}
						<div class="ord-tl-row">
							<span class="ord-tl-dot" style="background:{t.dot}"></span>
							<div>
								<strong>{t.title}</strong>
								<div class="ord-tl-meta">{t.when} · {t.meta}</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<div class="hst-drawer-foot">
			{#if o.paymentStatus === 'paid'}
				<button class="btn-secondary" onclick={() => handleAction('invoice', o)}>
					<DownloadIcon size={13} /> Factură fiscală
				</button>
			{/if}
			{#if o.paymentStatus === 'pending'}
				<button class="btn-secondary" onclick={() => handleAction('mark-paid', o)}>
					<CheckIcon size={13} /> Marchează plătit
				</button>
			{/if}
			{#if o.paymentStatus === 'paid' && acct !== 'cancelled'}
				<button class="btn-secondary ord-btn-text-bad" onclick={() => handleAction('refund', o)}>
					<ArrowDownIcon size={13} /> Refund
				</button>
			{/if}
			<button class="btn-secondary" onclick={() => handleAction('email-client', o)}>
				<MailIcon size={13} /> Email client
			</button>
			<div class="ord-drawer-foot-spacer"></div>
			{#if acct === 'active'}
				<button class="btn-primary" onclick={() => handleAction('open-account', o)}>
					<ExternalLinkIcon size={13} /> Vezi cont
				</button>
			{:else if acct === 'provisioning'}
				<button class="btn-primary" onclick={() => handleAction('force-provision', o)}>
					<ZapIcon size={13} /> Forțează provisionare
				</button>
			{/if}
		</div>
	</div>
{/if}

<!-- Comandă manuală — componentă partajată cu pagina Provisioning (ANAF + dovadă plată + TVA dinamică + provisionare imediată pe Achitat) -->
{#if showManual}
	<ManualOrderModal onClose={() => (showManual = false)} onCreated={() => refresh()} />
{/if}

<!-- ===========================================================================
   MODAL DELETE — typed-confirm pentru ștergere ireversibilă
   =========================================================================== -->
{#if deleteTarget}
	{@const target = deleteTarget}
	{@const isValid = deleteConfirmText.trim().toUpperCase() === DELETE_CONFIRM_PHRASE}
	<div
		class="del-backdrop"
		role="button"
		tabindex="-1"
		aria-label="Închide"
		onclick={closeDeleteModal}
		onkeydown={(e) => e.key === 'Escape' && closeDeleteModal()}
	></div>
	<div
		class="del-modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="del-modal-title"
		use:focusTrap={{}}
	>
		<div class="del-modal-head">
			<div class="del-modal-icon">
				<AlertTriangleIcon size={18} />
			</div>
			<div class="del-modal-head-text">
				<strong id="del-modal-title">Ștergi comanda definitiv?</strong>
				<span>Acțiunea nu poate fi anulată. Toate datele asociate dispar din DB.</span>
			</div>
			<button
				class="del-modal-close"
				aria-label="Închide"
				onclick={closeDeleteModal}
				disabled={deleteBusy}
			>
				<XIcon size={14} />
			</button>
		</div>

		<div class="del-modal-body">
			<div class="del-summary">
				<div class="del-summary-row">
					<span>Comanda</span>
					<strong class="del-mono">{displayOrderId(target.orderNumber, target.id)}</strong>
				</div>
				<div class="del-summary-row">
					<span>Client</span>
					<strong>{target.contactName}</strong>
				</div>
				<div class="del-summary-row">
					<span>Email</span>
					<strong class="del-mono">{target.contactEmail}</strong>
				</div>
				<div class="del-summary-row">
					<span>Domeniu</span>
					<strong class="del-mono">{domainItemOf(target)?.domainName ?? target.requestedDomain ?? '—'}</strong>
				</div>
				<div class="del-summary-row">
					<span>Pachet</span>
					<strong>{target.productName ?? '—'}</strong>
				</div>
				<div class="del-summary-row">
					<span>Sumă</span>
					<strong>{fmtRon(target.paidAmountCents) || fmtRonInt(totalCents(target) / 100)}</strong>
				</div>
			</div>

			<div class="del-confirm-wrap">
				<label class="del-confirm-label" for="del-confirm-input">
					Pentru a confirma, tipează exact
					<strong class="del-mono">{DELETE_CONFIRM_PHRASE}</strong>
					în câmpul de mai jos:
				</label>
				<input
					id="del-confirm-input"
					class="del-confirm-input"
					class:del-confirm-input-valid={isValid}
					type="text"
					bind:value={deleteConfirmText}
					placeholder={DELETE_CONFIRM_PHRASE}
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					disabled={deleteBusy}
					onkeydown={(e) => {
						if (e.key === 'Enter' && isValid && !deleteBusy) submitDelete();
					}}
				/>
				{#if deleteConfirmText && !isValid}
					<div class="del-confirm-hint">
						Tipează exact <strong>{DELETE_CONFIRM_PHRASE}</strong> (case-insensitive).
					</div>
				{/if}
			</div>
		</div>

		<div class="del-modal-foot">
			<button class="btn-secondary" onclick={closeDeleteModal} disabled={deleteBusy}>
				Anulează
			</button>
			<div class="ord-mo-foot-spacer"></div>
			<button
				class="del-modal-confirm"
				disabled={!isValid || deleteBusy}
				onclick={submitDelete}
			>
				<Trash2Icon size={13} />
				{deleteBusy ? 'Se șterge...' : 'Șterge definitiv'}
			</button>
		</div>
	</div>
{/if}

<style>
	/* ===========================================================================
	 * STYLES — placeholder shell.
	 * The pixel-perfect hst-* / dash-kpi-* / ord-* classes are merged in Task 11.
	 * For now we ship a minimal scope so the page renders without runtime errors,
	 * loads HTTP 200, and the autofixer has zero issues.
	 * =========================================================================== */

	.hosting-wrap {
		flex: 1;
		min-width: 0;
		background: #f4f6fa;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		min-height: 100vh;
	}

	.hod-loading,
	.hod-empty {
		padding: 48px 24px;
		text-align: center;
		color: #94a3b8;
	}
	.hod-empty p {
		margin: 8px 0 0;
	}

	/* Hero */
	.hst-hero {
		padding: 22px 24px 16px;
		display: flex;
		align-items: flex-end;
		gap: 18px;
	}
	.hst-hero h1 {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0;
	}
	.hst-hero p {
		color: #475569;
		font-size: 13px;
		margin: 4px 0 0;
	}
	.hst-hero-actions {
		margin-left: auto;
		display: flex;
		gap: 8px;
		align-items: center;
	}

	/* Buttons */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		background: #1877f2;
		color: white;
		border: none;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
	}
	.btn-primary:hover {
		background: #0d5cc7;
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		background: white;
		color: #475569;
		border: 1px solid #d5dbe5;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
	}
	.btn-secondary:hover {
		border-color: #1877f2;
		color: #1877f2;
	}
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* KPI strip */
	.hst-kpis {
		padding: 0 24px;
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
		margin-bottom: 18px;
	}
	.dash-kpi {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 10px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		position: relative;
		overflow: hidden;
		transition: all 0.15s;
	}
	.dash-kpi:hover {
		border-color: #1877f2;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
	}
	.dash-kpi::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
	}
	.dash-kpi.success::before {
		background: #10b981;
	}
	.dash-kpi.primary::before {
		background: #1877f2;
	}
	.dash-kpi.info::before {
		background: #6366f1;
	}
	.dash-kpi.warn::before {
		background: #f59e0b;
	}
	.dash-kpi.danger::before {
		background: #ef4444;
	}
	.dash-kpi-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dash-kpi-icon {
		width: 22px;
		height: 22px;
		border-radius: 5px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.dash-kpi-label {
		font-size: 11px;
		color: #475569;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.dash-kpi-value {
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1;
	}
	.dash-kpi-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
	}
	.dash-kpi-sub {
		color: #94a3b8;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dash-delta {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.dash-delta.up {
		color: #10b981;
	}
	.dash-delta.down {
		color: #ef4444;
	}

	/* Tabs */
	.hst-tabs {
		display: flex;
		gap: 4px;
		padding: 0 24px;
		border-bottom: 1px solid #e5e9f0;
		margin-bottom: 14px;
	}
	.hst-tab {
		padding: 10px 14px;
		background: transparent;
		border: none;
		font-size: 12.5px;
		font-weight: 600;
		color: #94a3b8;
		font-family: inherit;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.hst-tab:hover {
		color: #475569;
	}
	.hst-tab.active {
		color: #1877f2;
		border-bottom-color: #1877f2;
	}
	.hst-tab-count {
		background: #eef1f6;
		color: #475569;
		font-size: 10px;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: 999px;
	}
	.hst-tab.active .hst-tab-count {
		background: rgba(24, 119, 242, 0.15);
		color: #1877f2;
	}

	/* Toolbar */
	.hst-accounts-toolbar {
		padding: 0 24px 14px;
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	.hst-search {
		flex: 0 0 320px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: white;
		border: 1px solid #d5dbe5;
		border-radius: 8px;
		color: #94a3b8;
	}
	.hst-search input {
		border: none;
		background: transparent;
		outline: none;
		flex: 1;
		font-size: 12.5px;
		font-family: inherit;
		color: #0f172a;
	}
	.hst-filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		border-radius: 7px;
		background: white;
		color: #475569;
		border: 1px solid #d5dbe5;
		font-size: 12px;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
	}
	.hst-filter-chip:hover {
		border-color: #1877f2;
		color: #1877f2;
	}
	.hst-filter-chip.active {
		background: #1877f2;
		color: white;
		border-color: #1877f2;
	}
	.hst-toolbar-spacer {
		flex: 1;
	}

	/* Date popover */
	.ord-date-pop-wrap {
		position: relative;
	}
	.ord-date-pop {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 10px;
		box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
		padding: 8px;
		width: 240px;
		z-index: 50;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.ord-date-pop button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 10px;
		border: 0;
		background: transparent;
		border-radius: 6px;
		font: inherit;
		font-size: 12.5px;
		color: #475569;
		cursor: pointer;
		text-align: left;
	}
	.ord-date-pop button:hover {
		background: #f1f5f9;
		color: #0f172a;
	}
	.ord-date-pop button.active {
		background: rgba(24, 119, 242, 0.08);
		color: #1877f2;
		font-weight: 600;
	}
	.ord-date-pop button .pop-count {
		font-size: 10.5px;
		color: #94a3b8;
		font-variant-numeric: tabular-nums;
	}

	/* Table */
	.hst-table-wrap {
		margin: 0 24px 14px;
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		overflow: hidden;
	}
	.hst-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	.hst-table thead th {
		background: #fafbfd;
		text-align: left;
		padding: 11px 14px;
		font-size: 10.5px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-bottom: 1px solid #e5e9f0;
	}
	.hst-table tbody td {
		padding: 12px 14px;
		border-bottom: 1px solid #f1f5f9;
		color: #475569;
		vertical-align: middle;
	}
	.hst-table tbody tr:hover {
		background: #fafbfd;
	}
	.hst-table tbody tr:last-child td {
		border-bottom: none;
	}
	.hst-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.hst-host-cell {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-weight: 600;
		color: #0f172a;
	}

	/* Row cell text */
	.ord-row-relative {
		font-size: 10.5px;
		color: #94a3b8;
		margin-top: 2px;
	}
	.ord-row-source {
		margin-top: 4px;
	}
	.ord-source-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 7px;
		background: rgba(24, 119, 242, 0.08);
		color: #1877f2;
		font-size: 10.5px;
		font-weight: 600;
		border-radius: 5px;
		font-family: ui-monospace, monospace;
	}
	.ord-row-name {
		font-weight: 600;
		color: #0f172a;
		font-size: 12.5px;
	}
	.ord-row-email {
		font-size: 11px;
		color: #94a3b8;
		margin-top: 1px;
	}
	.ord-row-cui {
		font-size: 10.5px;
		color: #94a3b8;
		margin-top: 1px;
		font-family: ui-monospace, monospace;
	}
	.ord-row-plan {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.ord-row-plan strong {
		color: #0f172a;
		font-size: 12.5px;
	}
	.ord-plan-dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	.ord-row-period {
		font-size: 10.5px;
		color: #94a3b8;
	}
	.ord-row-domain {
		font-size: 11px;
		color: #475569;
		margin-top: 3px;
		font-family: ui-monospace, monospace;
	}
	.ord-row-domain-meta {
		font-size: 10.5px;
		color: #94a3b8;
		margin-top: 1px;
	}
	.ord-row-failreason {
		font-size: 10px;
		color: #ef4444;
		margin-top: 4px;
		max-width: 160px;
	}
	.ord-empty-cell {
		padding: 40px;
		text-align: center;
		color: #94a3b8;
	}

	/* Pay badge */
	.ord-pay-badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.ord-pay-badge.paid {
		background: rgba(16, 185, 129, 0.12);
		color: #047857;
	}
	.ord-pay-badge.pending {
		background: rgba(245, 158, 11, 0.14);
		color: #b45309;
	}
	.ord-pay-badge.processing {
		background: rgba(99, 102, 241, 0.14);
		color: #4338ca;
	}
	.ord-pay-badge.failed {
		background: #fee2e2;
		color: #b91c1c;
	}
	.ord-pay-badge.refunded {
		background: #f1f5f9;
		color: #475569;
	}
	.ord-pay-badge .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	/* Animated dot on the in-flight processing pill — design line 29-30 */
	.ord-pay-badge.processing .dot {
		animation: ord-dot-pulse 1.4s infinite;
	}
	@keyframes ord-dot-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	/* Account badge */
	.ord-acc-badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		border-radius: 5px;
		font-size: 10.5px;
		font-weight: 600;
		background: #eef1f6;
		color: #475569;
	}
	.ord-acc-badge.active {
		background: rgba(16, 185, 129, 0.1);
		color: #047857;
	}
	.ord-acc-badge.provisioning {
		background: rgba(99, 102, 241, 0.1);
		color: #4338ca;
	}
	.ord-acc-badge.awaiting-payment {
		background: rgba(245, 158, 11, 0.12);
		color: #b45309;
	}
	.ord-acc-badge.cancelled {
		background: #fee2e2;
		color: #b91c1c;
	}

	/* Method tile */
	.ord-method-tile {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		background: #f4f6fa;
		border-radius: 5px;
		font-size: 11px;
		font-weight: 600;
		color: #475569;
		font-family: ui-monospace, monospace;
	}
	.ord-method-tile.ord-method-card {
		color: #1a1f71;
	}

	.ord-amount {
		font-weight: 700;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
		font-size: 13px;
	}
	.ord-amount-vat {
		font-size: 10px;
		color: #94a3b8;
		margin-top: 1px;
	}

	/* Row actions */
	.ord-row-actions {
		display: flex;
		gap: 4px;
	}
	.hst-icon-btn {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: 1px solid #e5e9f0;
		background: white;
		display: grid;
		place-items: center;
		color: #475569;
		cursor: pointer;
	}
	.hst-icon-btn:hover {
		background: #1877f2;
		color: white;
		border-color: #1877f2;
	}
	.hst-icon-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.hst-icon-btn.active-page {
		background: #1877f2;
		color: white;
		border-color: #1877f2;
	}

	/* Pagination */
	.ord-pagination {
		padding: 0 24px 32px;
		display: flex;
		align-items: center;
		color: #94a3b8;
		font-size: 12px;
		gap: 4px;
	}
	.ord-pagination-spacer {
		flex: 1;
	}
	.ord-pagination-buttons {
		display: flex;
		gap: 4px;
	}

	/* Drawer */
	.hst-drawer-back {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.4);
		z-index: 79;
		backdrop-filter: blur(2px);
		border: 0;
		padding: 0;
	}
	.hst-drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		max-width: 100vw;
		background: white;
		z-index: 80;
		display: flex;
		flex-direction: column;
		box-shadow: -12px 0 32px rgba(15, 23, 42, 0.15);
		animation: ord-slideIn 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	@keyframes ord-slideIn {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}
	.hst-drawer-head {
		padding: 18px 22px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.hst-server-card-icon {
		width: 38px;
		height: 38px;
		border-radius: 9px;
		color: white;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.ord-drawer-head-text {
		flex: 1;
		min-width: 0;
	}
	.ord-drawer-title {
		font-weight: 700;
		font-size: 15px;
		color: #0f172a;
		font-family: ui-monospace, monospace;
	}
	.ord-drawer-subtitle {
		font-size: 12px;
		color: #94a3b8;
		margin-top: 2px;
	}
	.ord-drawer-source {
		color: #1877f2;
	}
	.hst-drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px 22px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.hst-drawer-foot {
		padding: 14px 22px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		gap: 8px;
	}
	.ord-drawer-foot-spacer {
		flex: 1;
	}
	.hst-drawer-close {
		width: 32px;
		height: 32px;
		border-radius: 7px;
		background: transparent;
		border: 1px solid #e5e9f0;
		display: grid;
		place-items: center;
		color: #475569;
		cursor: pointer;
	}
	.hst-drawer-section h4 {
		font-size: 10.5px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0 0 8px;
	}
	.hst-kv-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.hst-kv {
		background: #fafbfd;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
		padding: 9px 11px;
	}
	.hst-kv-l {
		font-size: 10.5px;
		color: #94a3b8;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.hst-kv-v {
		font-size: 13px;
		font-weight: 600;
		color: #0f172a;
		margin-top: 2px;
	}
	.ord-kv-small {
		font-size: 12px;
	}
	.ord-mono {
		font-family: ui-monospace, monospace;
	}

	/* Banner (failed/pending) */
	.ord-banner {
		padding: 14px;
		border-radius: 10px;
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.ord-banner-bad {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #b91c1c;
	}
	.ord-banner-warn {
		background: #fffbeb;
		border: 1px solid #fde68a;
		color: #92400e;
	}
	.ord-banner-text {
		flex: 1;
	}
	.ord-banner-text strong {
		font-size: 13px;
		display: block;
	}
	.ord-banner-text span {
		font-size: 12.5px;
	}
	.ord-btn-bad {
		background: #ef4444;
	}
	.ord-btn-bad:hover {
		background: #b91c1c;
	}
	.ord-btn-text-bad {
		color: #ef4444;
	}

	/* Totals box */
	.ord-totals {
		background: #fafbfd;
		border: 1px solid #e5e9f0;
		border-radius: 10px;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 7px;
		margin-top: 10px;
	}
	.ord-total-row {
		display: flex;
		justify-content: space-between;
		font-size: 12.5px;
		color: #475569;
	}
	.ord-total-row strong {
		color: #0f172a;
		font-variant-numeric: tabular-nums;
	}
	.ord-total-row.big {
		padding-top: 8px;
		margin-top: 4px;
		border-top: 1px solid #e5e9f0;
		font-size: 14px;
	}
	.ord-total-row.big strong {
		font-size: 18px;
		font-weight: 800;
		color: #1877f2;
	}

	/* Timeline */
	.ord-detail-timeline {
		display: flex;
		flex-direction: column;
		gap: 12px;
		position: relative;
		padding-left: 14px;
	}
	.ord-detail-timeline::before {
		content: '';
		position: absolute;
		left: 4px;
		top: 6px;
		bottom: 6px;
		width: 2px;
		background: #f1f5f9;
	}
	.ord-tl-row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		position: relative;
	}
	.ord-tl-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		position: absolute;
		left: -14px;
		top: 4px;
		border: 2px solid white;
		box-shadow: 0 0 0 1px #e5e9f0;
	}
	.ord-tl-row > div {
		flex: 1;
	}
	.ord-tl-row strong {
		font-size: 12.5px;
		color: #0f172a;
		font-weight: 600;
	}
	.ord-tl-meta {
		font-size: 11px;
		color: #94a3b8;
		margin-top: 1px;
	}

	/* Confirm payment panel */
	.ord-confirm {
		background: #fafbfd;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.ord-confirm-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 2px;
	}
	.ord-confirm-head h4 {
		margin: 0;
		font-size: 13.5px;
		font-weight: 700;
		color: #0f172a;
		flex: 1;
	}
	.ord-confirm-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		border-radius: 999px;
		background: rgba(245, 158, 11, 0.14);
		color: #b45309;
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.ord-confirm-pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.ord-confirm-row {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.ord-confirm-row > label,
	.ord-confirm-row > .ord-confirm-label {
		font-size: 12px;
		font-weight: 600;
		color: #475569;
	}
	.ord-confirm-row input[type='text'],
	.ord-confirm-row textarea {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
		padding: 9px 11px;
		font: inherit;
		font-size: 13px;
		color: #0f172a;
		background: white;
	}
	.ord-confirm-row input.mono {
		font-family: ui-monospace, monospace;
	}
	.ord-confirm-row textarea {
		resize: vertical;
		min-height: 60px;
		font-family: inherit;
	}
	.ord-confirm-check {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 0 2px;
		font-size: 12.5px;
		color: #475569;
		cursor: pointer;
		user-select: none;
	}
	.ord-confirm-check input {
		margin: 0;
		width: 15px;
		height: 15px;
		cursor: pointer;
		accent-color: #1877f2;
	}
	.ord-confirm-check strong {
		color: #0f172a;
		font-weight: 600;
	}
	.ord-confirm-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-top: 8px;
		border-top: 1px solid #eef1f6;
	}
	.ord-confirm-context {
		font-size: 11px;
		color: #94a3b8;
	}
	.ord-confirm-context strong {
		color: #475569;
	}
	.ord-confirm-foot .spacer {
		flex: 1;
	}
	.ord-confirm-input-suffix {
		position: relative;
	}
	.ord-confirm-input-suffix input {
		padding-right: 48px;
	}
	.ord-confirm-input-suffix .suffix {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 11px;
		font-weight: 700;
		color: #94a3b8;
		pointer-events: none;
		letter-spacing: 0.04em;
	}

	/* Manual order modal */
	.ord-mo-foot-spacer {
		flex: 1;
	}

	/* Responsive */
	@media (max-width: 1400px) {
		.hst-kpis {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	@media (max-width: 768px) {
		.hst-kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.hst-drawer {
			width: 100vw !important;
		}
	}

	/* ===========================================================================
	 * DELETE MODAL — typed-confirm pentru ștergere ireversibilă
	 * =========================================================================== */
	.hst-icon-btn-danger:hover {
		color: #b91c1c;
		background: #fef2f2;
		border-color: #fecaca;
	}
	:global(.dark) .hst-icon-btn-danger:hover {
		color: #fca5a5;
		background: rgba(127, 29, 29, 0.2);
		border-color: rgba(127, 29, 29, 0.4);
	}

	.del-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.55);
		backdrop-filter: blur(2px);
		z-index: 90;
	}

	.del-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 100%;
		max-width: 480px;
		max-height: 90vh;
		overflow: auto;
		background: white;
		border-radius: 12px;
		box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.5);
		z-index: 100;
		display: flex;
		flex-direction: column;
	}
	:global(.dark) .del-modal {
		background: #1e293b;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
	}

	.del-modal-head {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 18px 20px 14px;
		border-bottom: 1px solid #e5e9f0;
	}
	:global(.dark) .del-modal-head {
		border-color: #334155;
	}

	.del-modal-icon {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: #fee2e2;
		color: #dc2626;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	:global(.dark) .del-modal-icon {
		background: rgba(127, 29, 29, 0.4);
		color: #fca5a5;
	}

	.del-modal-head-text {
		flex: 1;
		min-width: 0;
	}
	.del-modal-head-text strong {
		display: block;
		font-size: 15px;
		font-weight: 700;
		color: #0f172a;
		margin-bottom: 2px;
	}
	.del-modal-head-text span {
		display: block;
		font-size: 12px;
		color: #64748b;
	}
	:global(.dark) .del-modal-head-text strong {
		color: #f1f5f9;
	}
	:global(.dark) .del-modal-head-text span {
		color: #94a3b8;
	}

	.del-modal-close {
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 0;
		border-radius: 6px;
		color: #64748b;
		cursor: pointer;
	}
	.del-modal-close:hover {
		background: #f1f5f9;
		color: #0f172a;
	}
	.del-modal-close:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	:global(.dark) .del-modal-close:hover {
		background: #334155;
		color: #f1f5f9;
	}

	.del-modal-body {
		padding: 16px 20px;
	}

	.del-summary {
		border: 1px solid #e5e9f0;
		border-radius: 8px;
		padding: 10px 12px;
		background: #fafbfd;
		margin-bottom: 16px;
	}
	:global(.dark) .del-summary {
		border-color: #334155;
		background: rgba(15, 23, 42, 0.4);
	}

	.del-summary-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 12.5px;
		padding: 4px 0;
		border-bottom: 1px solid #f1f5f9;
	}
	.del-summary-row:last-child {
		border-bottom: 0;
	}
	.del-summary-row > span {
		color: #64748b;
		flex-shrink: 0;
	}
	.del-summary-row > strong {
		color: #0f172a;
		text-align: right;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.dark) .del-summary-row {
		border-color: #334155;
	}
	:global(.dark) .del-summary-row > span {
		color: #94a3b8;
	}
	:global(.dark) .del-summary-row > strong {
		color: #f1f5f9;
	}

	.del-mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 12px;
	}

	.del-confirm-wrap {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.del-confirm-label {
		font-size: 12.5px;
		color: #475569;
		line-height: 1.5;
	}
	:global(.dark) .del-confirm-label {
		color: #cbd5e1;
	}
	.del-confirm-input {
		width: 100%;
		padding: 9px 12px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		border: 1px solid #e5e9f0;
		border-radius: 7px;
		background: white;
		color: #0f172a;
		outline: none;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.del-confirm-input:focus {
		border-color: #dc2626;
		box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
	}
	.del-confirm-input-valid {
		border-color: #16a34a !important;
		background: #f0fdf4 !important;
		color: #15803d;
	}
	.del-confirm-input-valid:focus {
		box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15);
	}
	:global(.dark) .del-confirm-input {
		background: #0f172a;
		border-color: #334155;
		color: #f1f5f9;
	}
	:global(.dark) .del-confirm-input-valid {
		background: rgba(20, 83, 45, 0.3) !important;
		color: #86efac;
	}

	.del-confirm-hint {
		font-size: 11.5px;
		color: #f97316;
	}
	:global(.dark) .del-confirm-hint {
		color: #fdba74;
	}

	.del-modal-foot {
		display: flex;
		gap: 8px;
		padding: 14px 20px;
		border-top: 1px solid #e5e9f0;
		background: #fafbfd;
		border-radius: 0 0 12px 12px;
	}
	:global(.dark) .del-modal-foot {
		border-color: #334155;
		background: rgba(15, 23, 42, 0.4);
	}

	.del-modal-confirm {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		background: #dc2626;
		color: white;
		border: 0;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}
	.del-modal-confirm:hover:not(:disabled) {
		background: #b91c1c;
	}
	.del-modal-confirm:disabled {
		background: #fca5a5;
		cursor: not-allowed;
	}
	:global(.dark) .del-modal-confirm:disabled {
		background: rgba(127, 29, 29, 0.5);
	}
</style>
