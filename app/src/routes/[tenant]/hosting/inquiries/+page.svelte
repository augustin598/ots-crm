<script lang="ts">
	import {
		getHostingOrders,
		updateHostingInquiryStatus,
		deleteHostingInquiry,
		acceptHostingOrderPayment,
		provisionFromInquiry,
		type HostingOrderRow,
		type HostingOrderItemRow
	} from '$lib/remotes/hosting-inquiries.remote';
	import { getDAServers, getDAServer } from '$lib/remotes/da-servers.remote';
	import { generateDaUsername, generateDaPassword } from '$lib/utils/da-generators';
	import { displayOrderId } from '$lib/utils/hosting-order-id';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { focusTrap } from '$lib/actions/focus-trap';
	import { tick } from 'svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import XIcon from '@lucide/svelte/icons/x';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Columns3Icon from '@lucide/svelte/icons/columns-3';
	import ListIcon from '@lucide/svelte/icons/list';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import PackageIcon from '@lucide/svelte/icons/package';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import CheckIcon from '@lucide/svelte/icons/check';

	type ActiveTab = 'all' | 'paid' | 'pending' | 'failed' | 'refunded';
	// NOTE: 'paid' is the "Achitate" tab — filters to paymentStatus === 'paid'.

	let ordersPromise = $state(getHostingOrders());

	async function refresh() {
		ordersPromise = getHostingOrders();
	}

	// ----- view state -----
	let activeTab = $state<ActiveTab>('all');
	let filterPackage = $state<string>(''); // hostingProductId or ''
	let filterMethod = $state<'all' | 'card' | 'op' | 'paypal' | 'revolut'>('all');
	let search = $state('');
	let openOrder = $state<HostingOrderRow | null>(null);
	let busyId = $state<string | null>(null);

	// Accept-payment dialog state — local to the drawer.
	let acceptOpen = $state(false);
	let acceptAmount = $state(''); // RON, decimal
	let acceptRef = $state('');
	let acceptNote = $state('');
	let acceptMethod = $state<'op' | 'card' | 'paypal' | 'revolut' | 'other'>('op');
	let acceptProvision = $state(true);
	let accepting = $state(false);

	// Dynamic accept-dialog "Referință" labels — bank/OP requires an explicit
	// transaction id so the printed Keez invoice shows "Bank: <id>" instead of
	// "Bank: -". Other methods (card POS, PayPal, Revolut) keep it optional.
	const acceptIsBankMethod = $derived(acceptMethod === 'op');
	const acceptRefLabel = $derived(
		acceptIsBankMethod
			? 'ID tranzacție bancă *'
			: acceptMethod === 'card'
				? 'ID tranzacție card / chitanță POS (opțional)'
				: acceptMethod === 'paypal'
					? 'PayPal transaction ID (opțional)'
					: acceptMethod === 'revolut'
						? 'Revolut transaction ID (opțional)'
						: 'Referință tranzacție (opțional)'
	);
	const acceptRefPlaceholder = $derived(
		acceptIsBankMethod
			? 'ex: OP nr. 12345 / Extras BT 21.05.2026 / Ref 4242...'
			: acceptMethod === 'card'
				? 'ex: ch_3TZyAw... / chitanță POS 4242'
				: acceptMethod === 'paypal'
					? 'ex: 8AB12345CD678901E'
					: acceptMethod === 'revolut'
						? 'ex: rvl_xxxxxxxx'
						: 'Identificator extern al plății'
	);

	// Provisioning form state — pre-populated from order/product, editable.
	let provServerId = $state('');
	let provPackageId = $state('');
	let provUsername = $state('');
	let provDomain = $state('');
	let provPassword = $state('');
	let provNotes = $state('');
	let provisioning = $state(false);
	let provPwdCopied = $state(false);
	let scrollToProvision = $state(false);

	// Lazy server + package lookups for the form dropdowns.
	let serversPromise = $state<ReturnType<typeof getDAServers> | null>(null);
	function ensureServersLoaded() {
		if (!serversPromise) serversPromise = getDAServers();
	}
	const selectedServerDetail = $derived(provServerId ? getDAServer(provServerId) : null);
	const drawerDaServer = $derived(
		openOrder?.productDaServerId ? getDAServer(openOrder.productDaServerId) : null
	);

	function openProvisionForm(o: HostingOrderRow) {
		ensureServersLoaded();
		provServerId = o.productDaServerId ?? '';
		provPackageId = o.productDaPackageId ?? '';
		const seed = o.clientBusinessName || o.contactName || o.contactEmail.split('@')[0];
		provUsername = generateDaUsername(seed);
		// Pre-fill from the public form. If the customer didn't enter a domain
		// (rare — domain step is mandatory on /pachete-hosting), admin types it.
		provDomain = o.requestedDomain ?? '';
		provPassword = generateDaPassword();
		provNotes = '';
		provPwdCopied = false;
	}

	function suggestUsername(o: HostingOrderRow) {
		const seed = o.clientBusinessName || o.contactName || o.contactEmail.split('@')[0];
		provUsername = generateDaUsername(seed);
	}

	function regeneratePassword() {
		provPassword = generateDaPassword();
		provPwdCopied = false;
	}

	async function copyPassword() {
		try {
			await navigator.clipboard.writeText(provPassword);
			provPwdCopied = true;
			setTimeout(() => (provPwdCopied = false), 2000);
		} catch {
			toast.error('Nu am putut copia parola');
		}
	}

	async function submitProvision(orderId: string) {
		if (!provServerId || !provUsername || !provDomain || !provPassword) {
			toast.error('Completează toate câmpurile obligatorii');
			return;
		}
		provisioning = true;
		try {
			const r = await provisionFromInquiry({
				inquiryId: orderId,
				daServerId: provServerId,
				daPackageId: provPackageId || undefined,
				daUsername: provUsername.trim().toLowerCase(),
				domain: provDomain.trim().toLowerCase(),
				password: provPassword,
				notes: provNotes.trim() || undefined
			});
			if (r.ok) {
				toast.success(`Cont DA creat: ${r.daUsername} (${r.domain})`);
				openOrder = null;
				await refresh();
			} else {
				toast.error(`Provisioning eșuat: ${r.error}`);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			provisioning = false;
		}
	}

	/**
	 * Open the drawer. Pre-populates the provisioning form when applicable.
	 * Tracks which order id was last initialized so reopening the SAME order
	 * (accidental double-click, navigating back) keeps any in-progress edits
	 * the admin made — domain typed, custom password — instead of clobbering
	 * them with a fresh `openProvisionForm` call.
	 */
	let lastProvisionInitId = $state<string | null>(null);
	function openDrawer(o: HostingOrderRow) {
		openOrder = o;
		if (
			o.paymentStatus === 'paid' &&
			!o.hostingAccountId &&
			lastProvisionInitId !== o.id
		) {
			openProvisionForm(o);
			lastProvisionInitId = o.id;
		}
	}

	async function openOrderAtProvision(o: HostingOrderRow) {
		openDrawer(o);
		scrollToProvision = true;
		await tick();
		const el = document.getElementById('drawer-provisioning');
		if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		scrollToProvision = false;
	}

	function openAcceptDialog(o: HostingOrderRow) {
		acceptOpen = true;
		// Default the manual-accept method to whatever the customer selected on
		// the public form; admin can switch in the dropdown. (Earlier this
		// silently rewrote 'card' → 'op' which surprised admins doing POS card
		// captures — removed.)
		const m = o.paymentMethod;
		acceptMethod =
			m === 'op' || m === 'card' || m === 'paypal' || m === 'revolut' ? m : 'op';
		// productPrice is stored in cents (per hostingProduct.price schema). The
		// input expects RON (decimal), so divide. Earlier we set the input to the
		// raw cents value, which caused `Math.round(amt * 100)` in submitAccept to
		// store 100× the real amount (e.g. 139900 cents → input "139900" → saved
		// as 13_990_000 = 139,900 RON, when it should have been 1.399 RON).
		const guessedCents = o.productPrice ?? 0;
		acceptAmount = guessedCents > 0 ? String(guessedCents / 100) : '';
		acceptRef = '';
		acceptNote = '';
		acceptProvision = !o.hostingAccountId;
	}

	async function submitAccept(orderId: string) {
		const amt = parseFloat(acceptAmount.replace(',', '.'));
		if (!Number.isFinite(amt) || amt < 0) {
			toast.error('Suma e invalidă');
			return;
		}
		// Bank/OP requires the transaction id so we can reconcile the payment
		// against the bank statement + show it on the Keez "Notă Articol".
		// Without it, the printed invoice would read "Bank: -" which fails audit.
		if (acceptMethod === 'op' && !acceptRef.trim()) {
			toast.error('ID-ul tranzacției bancare e obligatoriu pentru Ordin de plată.');
			return;
		}
		accepting = true;
		try {
			const r = await acceptHostingOrderPayment({
				id: orderId,
				paymentMethod: acceptMethod,
				paidAmountCents: Math.round(amt * 100),
				paymentReference: acceptRef.trim() || undefined,
				note: acceptNote.trim() || undefined,
				triggerProvisioning: acceptProvision
			});
			if (r.provisioned === false && 'reason' in r && r.reason && r.reason !== 'skipped_by_caller') {
				toast.warning(`Plată acceptată, dar provisioning DA a eșuat: ${r.reason}`);
			} else if (r.provisioned && 'daUsername' in r && r.daUsername) {
				toast.success(`Plată acceptată · DA: ${r.daUsername}`);
			} else {
				toast.success('Plată acceptată');
			}
			acceptOpen = false;
			openOrder = null;
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			accepting = false;
		}
	}

	async function setStatus(id: string, status: 'new' | 'contacted' | 'converted' | 'discarded') {
		busyId = id;
		try {
			await updateHostingInquiryStatus({ id, status });
			toast.success('Status actualizat');
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			busyId = null;
		}
	}

	async function handleDelete(o: HostingOrderRow) {
		if (!confirm(`Ștergi comanda de la ${o.contactName}?`)) return;
		busyId = o.id;
		try {
			await deleteHostingInquiry(o.id);
			toast.success('Comandă ștearsă');
			if (openOrder?.id === o.id) openOrder = null;
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			busyId = null;
		}
	}

	function fmtDate(d: Date | string | null): string {
		if (!d) return '—';
		try {
			return new Date(d).toLocaleString('ro-RO', {
				day: '2-digit',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return String(d);
		}
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
		return `acum ${dd} ${dd === 1 ? 'zi' : 'zile'}`;
	}

	function fmtMoney(amountCents: number | null, currency: string | null): string {
		if (amountCents === null) return '—';
		const v = amountCents / 100;
		try {
			return v.toLocaleString('ro-RO', {
				style: 'currency',
				currency: currency || 'RON',
				minimumFractionDigits: v % 1 === 0 ? 0 : 2,
				maximumFractionDigits: 2
			});
		} catch {
			return `${v} ${currency ?? 'RON'}`;
		}
	}

	function statusLabel(s: string): string {
		const m: Record<string, string> = {
			new: 'Nou',
			contacted: 'Contactat',
			converted: 'Convertit',
			discarded: 'Respins',
			abandoned: 'Abandonat'
		};
		return m[s] ?? s;
	}

	function paymentLabel(s: string): string {
		const m: Record<string, string> = {
			pending: 'În așteptare',
			paid: 'Plătit',
			failed: 'Eșuat',
			refunded: 'Refund'
		};
		return m[s] ?? s;
	}

	function methodLabel(s: string | null): string {
		if (!s) return '—';
		const m: Record<string, string> = {
			card: 'Card',
			op: 'Ordin de plată',
			paypal: 'PayPal',
			revolut: 'Revolut',
			other: 'Altă metodă'
		};
		return m[s] ?? s;
	}

	function methodIcon(s: string | null): typeof CreditCardIcon {
		if (s === 'op') return BanknoteIcon;
		return CreditCardIcon;
	}

	function provisioningLabel(o: HostingOrderRow): string {
		if (o.hostingAccountId) return 'Provizionat';
		if (o.paymentStatus === 'paid') return 'Așteaptă provisioning';
		return 'Neînceput';
	}

	function applyFilters(list: HostingOrderRow[]): HostingOrderRow[] {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return list.filter((o) => {
			// Tab filter
			if (activeTab === 'pending' && o.paymentStatus !== 'pending') return false;
			if (activeTab === 'failed' && o.paymentStatus !== 'failed') return false;
			if (activeTab === 'refunded' && o.paymentStatus !== 'refunded') return false;
			if (activeTab === 'paid' && o.paymentStatus !== 'paid') return false;
			// Dropdown filters
			if (filterPackage && o.hostingProductId !== filterPackage) return false;
			if (filterMethod !== 'all' && o.paymentMethod !== filterMethod) return false;
			// Search
			if (search) {
				const q = search.toLowerCase();
				const hay = [
					displayOrderId(o.orderNumber, o.id),
					o.contactName,
					o.contactEmail,
					o.companyName ?? '',
					o.vatNumber ?? '',
					o.productName ?? '',
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

	type HistoryEntry = {
		kind: 'placed' | 'paid' | 'failed' | 'provisioning' | 'provisioned' | 'refunded';
		at: Date | string | null;
		label: string;
		meta: string;
	};

	function buildHistory(o: HostingOrderRow, daServerName: string | null): HistoryEntry[] {
		const out: HistoryEntry[] = [];
		out.push({
			kind: 'placed',
			at: o.createdAt,
			label: 'Comandă plasată',
			meta: `de pe /${o.source}`
		});
		if (o.paymentStatus === 'paid') {
			out.push({
				kind: 'paid',
				at: o.paidAt ?? o.acceptedAt ?? o.createdAt,
				label: 'Plată confirmată',
				meta: `${methodLabel(o.paymentMethod)} · ${fmtMoney(o.paidAmountCents, o.productCurrency)}`
			});
		}
		if (o.paymentStatus === 'failed') {
			out.push({
				kind: 'failed',
				at: o.createdAt,
				label: 'Plată eșuată',
				meta: 'Card refuzat de bancă'
			});
		}
		if (o.paymentStatus === 'refunded') {
			out.push({
				kind: 'refunded',
				at: o.acceptedAt ?? o.createdAt,
				label: 'Refundat',
				meta: 'Sumă returnată'
			});
		}
		if (o.hostingAccountId && o.daUsername) {
			out.push({
				kind: 'provisioned',
				at: o.paidAt ?? o.createdAt,
				label: 'Cont DirectAdmin creat',
				meta: `Server ${daServerName ?? '—'} · credențiale trimise pe ${o.contactEmail}`
			});
		} else if (o.paymentStatus === 'paid' && !o.hostingAccountId) {
			out.push({
				kind: 'provisioning',
				at: o.paidAt ?? o.createdAt,
				label: 'Cont în provisionare',
				meta: 'în curs · Server auto-alocat · credențiale în max 5 minute'
			});
		}
		return out;
	}

	/** Sum of all items × quantity, TTC. */
	function lineTotalCents(items: HostingOrderItemRow[]): number {
		return items.reduce((a, it) => a + it.unitPriceCents * it.quantity, 0);
	}

	/** Derived TVA — sum of each item's TVA portion at its own vat_rate. */
	function lineTvaCents(items: HostingOrderItemRow[]): number {
		return items.reduce((a, it) => {
			const lineTtc = it.unitPriceCents * it.quantity;
			return a + Math.round((lineTtc * it.vatRate) / (100 + it.vatRate));
		}, 0);
	}

	/** Visible (non-zero) items — hide "Domeniu X (existent)" lines that have 0 cost. */
	function visibleItems(items: HostingOrderItemRow[]): HostingOrderItemRow[] {
		return items.filter((it) => it.unitPriceCents > 0);
	}

	function billingCycleLabel(cycle: string | null): string {
		if (cycle === 'yearly') return 'Anual';
		if (cycle === 'monthly') return 'Lunar';
		return '—';
	}

	function domainModeLabel(mode: string | null): string {
		if (mode === 'buy') return 'Cumpărat nou';
		if (mode === 'transfer') return 'Transfer';
		if (mode === 'have') return 'Existent';
		return '—';
	}

	function accountStatusLabel(o: HostingOrderRow): {
		text: string;
		tone: 'ok' | 'warn' | 'bad' | 'neutral';
	} {
		if (o.hostingAccountId && o.daAccountStatus === 'active') return { text: 'Activ', tone: 'ok' };
		if (o.paymentStatus === 'paid' && !o.hostingAccountId)
			return { text: 'Se creează', tone: 'warn' };
		if (o.paymentStatus === 'failed') return { text: 'Anulat', tone: 'neutral' };
		if (o.paymentStatus === 'refunded') return { text: 'Refundat', tone: 'neutral' };
		return { text: 'Așteaptă plată', tone: 'warn' };
	}

	function fmtTime(d: Date | string | null): string {
		if (!d) return '';
		try {
			return new Date(d).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	function paymentTone(s: string): 'ok' | 'warn' | 'bad' | 'neutral' {
		if (s === 'paid') return 'ok';
		if (s === 'pending') return 'warn';
		if (s === 'failed') return 'bad';
		if (s === 'refunded') return 'neutral';
		return 'neutral';
	}

	function counts(list: HostingOrderRow[]) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
		const startOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
		const endOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);

		const paidThisMonth = list
			.filter((o) => o.paidAt && new Date(o.paidAt).getTime() >= startOfMonth.getTime())
			.reduce((a, o) => a + (o.paidAmountCents ?? 0), 0);
		const paidPrevMonth = list
			.filter((o) => {
				if (!o.paidAt) return false;
				const t = new Date(o.paidAt).getTime();
				return t >= startOfPrevMonth.getTime() && t <= endOfPrevMonth.getTime();
			})
			.reduce((a, o) => a + (o.paidAmountCents ?? 0), 0);
		const revenueDeltaPct =
			paidPrevMonth > 0 ? ((paidThisMonth - paidPrevMonth) / paidPrevMonth) * 100 : null;

		const pending = list.filter((o) => o.paymentStatus === 'pending');
		const failed = list.filter((o) => o.paymentStatus === 'failed');
		const refunded = list.filter((o) => o.paymentStatus === 'refunded');
		const pendingAmount = pending.reduce((a, o) => a + (o.productPrice ?? 0), 0);
		const failedAmount = failed.reduce((a, o) => a + (o.productPrice ?? 0), 0);

		const createdToday = list.filter(
			(o) => o.createdAt && new Date(o.createdAt).getTime() >= today.getTime()
		).length;
		const yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);
		const createdYesterday = list.filter((o) => {
			if (!o.createdAt) return false;
			const t = new Date(o.createdAt).getTime();
			return t >= yesterday.getTime() && t < today.getTime();
		}).length;

		const paidCount = list.filter((o) => o.paymentStatus === 'paid').length;

		return {
			total: list.length,
			createdToday,
			createdYesterday,
			paidCount,
			pendingCount: pending.length,
			pendingAmount,
			failedCount: failed.length,
			failedAmount,
			refundedCount: refunded.length,
			paidThisMonth,
			revenueDeltaPct
		};
	}

	function exportCsv(list: HostingOrderRow[]) {
		const header = [
			'Data',
			'Nume',
			'Email',
			'Firmă',
			'CUI',
			'Pachet',
			'Sumă',
			'Monedă',
			'Metodă',
			'Status plată',
			'Funnel',
			'Cont DA',
			'Domeniu'
		];
		const rows = list.map((o) => [
			fmtDate(o.createdAt),
			o.contactName,
			o.contactEmail,
			o.companyName ?? '',
			o.vatNumber ?? '',
			o.productName ?? '',
			o.paidAmountCents != null ? String(o.paidAmountCents / 100) : '',
			o.productCurrency ?? '',
			methodLabel(o.paymentMethod),
			paymentLabel(o.paymentStatus),
			statusLabel(o.status),
			o.daUsername ?? '',
			o.daDomain ?? ''
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

<div class="hod-page">
	{#await ordersPromise}
		<div class="hod-loading">Se încarcă comenzile…</div>
	{:then orders}
		{@const c = counts(orders)}
		{@const filtered = applyFilters(orders)}
		{@const productOptions = Array.from(
			new Map(
				orders
					.filter((o) => o.hostingProductId && o.productName)
					.map((o) => [o.hostingProductId as string, o.productName as string])
			).entries()
		)}

		<!-- Hero -->
		<div class="hod-hero">
			<div>
				<h1>Comenzi hosting</h1>
				<p>
					Comenzile primite de pe pagina publică /pachete-hosting · {c.total} total · {c.createdToday}
					azi · {fmtMoney(c.paidThisMonth, 'RON')} achitați
				</p>
			</div>
			<div class="hod-hero-actions">
				<button class="hod-btn hod-btn-ghost" onclick={() => refresh()}>
					<RefreshCwIcon size={14} /> Refresh
				</button>
				<button
					class="hod-btn hod-btn-ghost"
					onclick={() => exportCsv(filtered)}
					disabled={filtered.length === 0}
				>
					<DownloadIcon size={14} /> Export CSV
				</button>
				<a href="/pachete-hosting" target="_blank" rel="noopener" class="hod-btn hod-btn-ghost">
					<ExternalLinkIcon size={14} /> Pagina publică
				</a>
			</div>
		</div>

		<!-- KPI strip -->
		<div class="hod-kpis">
			<div class="hod-kpi" data-tone="info">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<ShoppingCartIcon size={14} />
						<span>COMENZI TOTAL</span>
					</div>
					<div class="hod-kpi-value">{c.total}</div>
					<div class="hod-kpi-foot">+{c.createdToday} azi · {c.createdYesterday} ieri</div>
				</div>
			</div>

			<div class="hod-kpi" data-tone="ok">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<TrendingUpIcon size={14} />
						<span>REVENUE ACHITAT</span>
					</div>
					<div class="hod-kpi-value">{fmtMoney(c.paidThisMonth, 'RON')}</div>
					<div class="hod-kpi-foot">
						{#if c.revenueDeltaPct == null}
							luna curentă
						{:else}
							{c.revenueDeltaPct >= 0 ? '+' : ''}{c.revenueDeltaPct.toFixed(1)}% vs luna trecută
						{/if}
					</div>
				</div>
			</div>

			<div class="hod-kpi" data-tone="warn">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<ClockIcon size={14} />
						<span>PLĂȚI ÎN AȘTEPTARE</span>
					</div>
					<div class="hod-kpi-value">{fmtMoney(c.pendingAmount, 'RON')}</div>
					<div class="hod-kpi-foot">{c.pendingCount} comenzi pending</div>
				</div>
			</div>

			<div class="hod-kpi" data-tone="bad">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<AlertTriangleIcon size={14} />
						<span>PLĂȚI EȘUATE</span>
					</div>
					<div class="hod-kpi-value">{fmtMoney(c.failedAmount, 'RON')}</div>
					<div class="hod-kpi-foot">{c.failedCount} comenzi de recuperat</div>
				</div>
			</div>

			<div class="hod-kpi" data-tone="neutral">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<RotateCcwIcon size={14} />
						<span>REFUNDATE</span>
					</div>
					<div class="hod-kpi-value">{c.refundedCount}</div>
					<div class="hod-kpi-foot">istoric tenant</div>
				</div>
			</div>
		</div>

		<!-- Tabs -->
		<div class="hod-tabs" role="tablist">
			<button
				role="tab"
				aria-selected={activeTab === 'all'}
				class:active={activeTab === 'all'}
				onclick={() => (activeTab = 'all')}
			>
				Toate <span class="hod-tab-count">{c.total}</span>
			</button>
			<button
				role="tab"
				aria-selected={activeTab === 'paid'}
				class:active={activeTab === 'paid'}
				onclick={() => (activeTab = 'paid')}
			>
				Achitate <span class="hod-tab-count">{c.paidCount}</span>
			</button>
			<button
				role="tab"
				aria-selected={activeTab === 'pending'}
				class:active={activeTab === 'pending'}
				onclick={() => (activeTab = 'pending')}
			>
				În așteptare <span class="hod-tab-count">{c.pendingCount}</span>
			</button>
			<button
				role="tab"
				aria-selected={activeTab === 'failed'}
				class:active={activeTab === 'failed'}
				onclick={() => (activeTab = 'failed')}
			>
				Eșuate <span class="hod-tab-count">{c.failedCount}</span>
			</button>
			<button
				role="tab"
				aria-selected={activeTab === 'refunded'}
				class:active={activeTab === 'refunded'}
				onclick={() => (activeTab = 'refunded')}
			>
				Refundate <span class="hod-tab-count">{c.refundedCount}</span>
			</button>
		</div>

		<!-- Filter row -->
		<div class="hod-filters">
			<div class="hod-search">
				<SearchIcon size={14} />
				<input placeholder="Caută ID, nume, email, domeniu…" bind:value={search} />
			</div>
			<label class="hod-filter-wrap">
				<PackageIcon size={14} />
				<select bind:value={filterPackage}>
					<option value="">Pachet — toate</option>
					{#each productOptions as [id, name] (id)}
						<option value={id}>{name}</option>
					{/each}
				</select>
			</label>
			<label class="hod-filter-wrap">
				<CreditCardIcon size={14} />
				<select bind:value={filterMethod}>
					<option value="all">Metodă — toate</option>
					<option value="card">Card</option>
					<option value="op">Ordin de plată</option>
					<option value="paypal">PayPal</option>
					<option value="revolut">Revolut</option>
				</select>
			</label>
			<label class="hod-filter-wrap" data-disabled="true" title="În curând">
				<CalendarIcon size={14} />
				<select disabled>
					<option>Perioadă</option>
				</select>
			</label>
			<label class="hod-filter-wrap" data-disabled="true" title="În curând">
				<CalendarDaysIcon size={14} />
				<select disabled>
					<option>Data</option>
				</select>
			</label>
		</div>

		{#if filtered.length === 0}
			<div class="hod-empty">
				<ShoppingCartIcon size={40} />
				<p>Nicio comandă pentru filtrele curente.</p>
			</div>
		{:else}
			<div class="hod-table-wrap">
				<table class="hod-table">
					<thead>
						<tr>
							<th>COMANDĂ</th>
							<th>CLIENT</th>
							<th>PACHET · DOMENIU</th>
							<th>METODĂ</th>
							<th class="num">SUMĂ</th>
							<th>STATUS PLATĂ</th>
							<th>STATUS CONT</th>
							<th class="hod-actions-th"></th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as o (o.id)}
							{@const rowDomainItem = (o.items ?? []).find((i) => i.kind === 'domain') ?? null}
							{@const rowTotalCents =
								o.paidAmountCents ??
								(o.items?.length
									? (o.items ?? []).reduce((a, it) => a + it.unitPriceCents * it.quantity, 0)
									: (o.productPrice ?? 0))}
							{@const rowTvaCents = (o.items ?? []).reduce(
								(a, it) =>
									a + Math.round((it.unitPriceCents * it.quantity * it.vatRate) / (100 + it.vatRate)),
								0
							)}
							{@const rowAcct = accountStatusLabel(o)}
							<tr onclick={() => openDrawer(o)}>
								<td>
									<div class="hod-cell-strong">{displayOrderId(o.orderNumber, o.id)}</div>
									<div class="hod-cell-muted">{fmtRelative(o.createdAt)}</div>
									<div class="hod-cell-faint hod-cell-source">
									<FileTextIcon size={11} /> /{o.source}
								</div>
								</td>
								<td>
									<div class="hod-cell-strong">{o.contactName}</div>
									<div class="hod-cell-muted">{o.contactEmail}</div>
								</td>
								<td>
									<div class="hod-cell-package">
										<span class="hod-pkg-dot"></span>
										<span class="hod-cell-strong">{o.productName ?? '—'}</span>
										<span class="hod-cell-muted">
											{billingCycleLabel(o.productBillingCycle).toLowerCase()}
										</span>
									</div>
									{#if rowDomainItem?.domainName}
										<div class="hod-cell-domain">{rowDomainItem.domainName}</div>
										{#if rowDomainItem.unitPriceCents > 0}
											<div class="hod-cell-faint">
												+ {fmtMoney(rowDomainItem.unitPriceCents, o.productCurrency)} domeniu nou
											</div>
										{:else if rowDomainItem.domainMode === 'transfer'}
											<div class="hod-cell-faint">domeniu transfer</div>
										{:else if rowDomainItem.domainMode === 'have'}
											<div class="hod-cell-faint">domeniu existent</div>
										{/if}
									{:else if o.requestedDomain}
										<div class="hod-cell-domain">{o.requestedDomain}</div>
									{/if}
								</td>
								<td>
									<div class="hod-cell-strong">{methodLabel(o.paymentMethod)}</div>
								</td>
								<td class="num">
									<div class="hod-cell-strong">
										{fmtMoney(rowTotalCents, o.productCurrency)}
									</div>
									<div class="hod-cell-faint">
										incl. TVA {fmtMoney(rowTvaCents, o.productCurrency)}
									</div>
								</td>
								<td>
									<span class="hod-pill" data-tone={paymentTone(o.paymentStatus)}>
										<span class="hod-dot"></span>{paymentLabel(o.paymentStatus).toUpperCase()}
									</span>
								</td>
								<td>
									<span class="hod-acct-label" data-tone={rowAcct.tone}>
										{rowAcct.text}
									</span>
								</td>
								<td class="hod-actions-cell">
									<div class="hod-row-actions" onclick={(e) => e.stopPropagation()} role="presentation">
										<button
											class="hod-icon-btn"
											title="Detalii"
											aria-label="Detalii"
											onclick={() => openDrawer(o)}
										>
											<EyeIcon size={14} />
										</button>
										{#if o.paymentStatus === 'pending'}
											<button
												class="hod-icon-btn"
												title="Marchează plătit"
												aria-label="Marchează plătit"
												onclick={() => {
													openDrawer(o);
													openAcceptDialog(o);
												}}
											>
												<CheckIcon size={14} />
											</button>
										{:else if o.paymentStatus === 'failed'}
											<button
												class="hod-icon-btn"
												title="Retry"
												aria-label="Retry"
												onclick={() => {
													openDrawer(o);
													openAcceptDialog(o);
												}}
											>
												<RotateCcwIcon size={14} />
											</button>
										{:else if o.paymentStatus === 'paid' && !o.hostingAccountId}
											<button
												class="hod-icon-btn"
												title="Forțează provisionare"
												aria-label="Forțează provisionare"
												onclick={() => openOrderAtProvision(o)}
											>
												<SparklesIcon size={14} />
											</button>
										{:else if o.paymentStatus === 'paid' && o.hostingAccountId}
											<a
												class="hod-icon-btn"
												title="Factură fiscală"
												aria-label="Factură fiscală"
												href={`/${page.params.tenant}/invoices?clientEmail=${encodeURIComponent(o.contactEmail)}`}
											>
												<DownloadIcon size={14} />
											</a>
										{/if}
										<a
											class="hod-icon-btn"
											title="Email client"
											aria-label="Email client"
											href={`mailto:${o.contactEmail}?subject=${encodeURIComponent('Comanda ' + displayOrderId(o.orderNumber, o.id))}`}
										>
											<MailIcon size={14} />
										</a>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:catch err}
		<div class="hod-empty">
			<AlertTriangleIcon size={40} />
			<p>Eroare la încărcare: {err instanceof Error ? err.message : String(err)}</p>
		</div>
	{/await}
</div>

{#if openOrder}
	{@const o = openOrder}
	{@const items = o.items ?? []}
	{@const visItems = visibleItems(items)}
	{@const totalCents = o.paidAmountCents ?? lineTotalCents(items)}
	{@const tvaCents = lineTvaCents(items)}
	{@const acctStatus = accountStatusLabel(o)}
	{@const domainItem = items.find((it) => it.kind === 'domain') ?? null}

	<button
		class="hod-drawer-back"
		aria-label="Închide"
		onclick={() => {
			openOrder = null;
			acceptOpen = false;
		}}
	></button>

	<div
		class="hod-drawer"
		role="dialog"
		aria-modal="true"
		aria-labelledby="hod-drawer-title"
		use:focusTrap={{ initialFocus: '.hod-drawer-close' }}
	>
		<!-- Header -->
		<header class="hod-drawer-head">
			<div class="hod-drawer-head-icon">
				<ShoppingCartIcon size={18} />
			</div>
			<div class="hod-drawer-head-text">
				<div class="hod-drawer-title" id="hod-drawer-title">
					{displayOrderId(o.orderNumber, o.id)}
				</div>
				<div class="hod-drawer-subtitle">
					{fmtRelative(o.createdAt)}, {fmtTime(o.createdAt)} · de pe /{o.source}
				</div>
			</div>
			<span class="hod-pill" data-tone={paymentTone(o.paymentStatus)}>
				<span class="hod-dot"></span>{paymentLabel(o.paymentStatus).toUpperCase()}
			</span>
			<button
				class="hod-drawer-close"
				aria-label="Închide"
				onclick={() => {
					openOrder = null;
					acceptOpen = false;
				}}
			>
				<XIcon size={18} />
			</button>
		</header>

		<!-- Body -->
		<div class="hod-drawer-body">
			<!-- Failed-payment banner -->
			{#if o.paymentStatus === 'failed'}
				<div class="hod-banner hod-banner-bad">
					<div>
						<strong>Plata a eșuat</strong>
						<div>Card refuzat de bancă · cod 51 (fonduri insuficiente)</div>
					</div>
					<button class="hod-btn hod-btn-bad" onclick={() => openAcceptDialog(o)}>
						<RotateCcwIcon size={14} /> Retry
					</button>
				</div>
			{/if}

			<!-- Accept payment subform (renders inline above sections when triggered) -->
			{#if acceptOpen}
				<section class="hod-accept">
					<div class="hod-accept-head">
						<h3>Confirmă încasarea</h3>
						<span class="hod-pill" data-tone="warn">
							<span class="hod-dot"></span>ÎN AȘTEPTARE
						</span>
					</div>

					<div class="hod-tab-group" role="tablist">
						<button
							role="tab"
							aria-selected={acceptMethod === 'card'}
							class:active={acceptMethod === 'card'}
							onclick={() => (acceptMethod = 'card')}
						>
							<CreditCardIcon size={14} /> Card (offline / POS)
						</button>
						<button
							role="tab"
							aria-selected={acceptMethod === 'op'}
							class:active={acceptMethod === 'op'}
							onclick={() => (acceptMethod = 'op')}
						>
							<BanknoteIcon size={14} /> Transfer bancar / OP
						</button>
						<button
							role="tab"
							aria-selected={acceptMethod === 'other'}
							class:active={acceptMethod === 'other'}
							onclick={() => (acceptMethod = 'other')}
						>
							Cash
						</button>
					</div>

					<label class="hod-input-block">
						<span>SUMĂ ({o.productCurrency ?? 'RON'})</span>
						<input
							type="text"
							inputmode="decimal"
							bind:value={acceptAmount}
							placeholder="123.45"
						/>
					</label>

					<label class="hod-input-block">
						<span>{acceptRefLabel.toUpperCase()}</span>
						<input
							type="text"
							bind:value={acceptRef}
							placeholder={acceptRefPlaceholder}
							maxlength="200"
							required={acceptIsBankMethod}
						/>
					</label>

					<label class="hod-input-block">
						<span>NOTĂ (OPȚIONAL)</span>
						<textarea
							bind:value={acceptNote}
							maxlength="500"
							rows="2"
							placeholder="Detalii pentru audit intern"
						></textarea>
					</label>

					<label class="hod-check">
						<input type="checkbox" bind:checked={acceptProvision} />
						<span> Declanșează provisioning DirectAdmin imediat după confirmare </span>
					</label>

					<div class="hod-accept-foot">
						<div class="hod-accept-context">
							Pachet <strong>{o.productName ?? '—'}</strong> · {o.requestedDomain ?? '—'}
						</div>
						<button class="hod-btn hod-btn-ghost" onclick={() => (acceptOpen = false)}>
							Anulează
						</button>
						<button
							class="hod-btn hod-btn-primary"
							disabled={accepting}
							onclick={() => submitAccept(o.id)}
						>
							<CheckCircle2Icon size={14} /> Confirmă
						</button>
					</div>
				</section>
			{/if}

			<!-- CLIENT -->
			<section class="hod-section">
				<div class="hod-section-label">CLIENT</div>
				<div class="hod-grid-2">
					<div class="hod-input-block hod-readonly">
						<span>NUME</span>
						<div class="hod-value">{o.contactName}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>EMAIL</span>
						<div class="hod-value">{o.contactEmail}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>TIP</span>
						<div class="hod-value">
							{o.companyName ? 'Persoană juridică' : 'Persoană fizică'}
						</div>
					</div>
					{#if o.vatNumber}
						<div class="hod-input-block hod-readonly">
							<span>CUI</span>
							<div class="hod-value">{o.vatNumber}</div>
						</div>
					{/if}
				</div>
			</section>

			<!-- DETALII COMANDĂ -->
			<section class="hod-section">
				<div class="hod-section-label">DETALII COMANDĂ</div>
				<div class="hod-grid-2">
					<div class="hod-input-block hod-readonly">
						<span>PACHET</span>
						<div class="hod-value hod-link">{o.productName ?? '—'}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>FACTURARE</span>
						<div class="hod-value">{billingCycleLabel(o.productBillingCycle)}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>DOMENIU</span>
						<div class="hod-value">
							{domainItem?.domainName ?? o.requestedDomain ?? '—'}
						</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>MOD DOMENIU</span>
						<div class="hod-value">{domainModeLabel(domainItem?.domainMode ?? null)}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>SERVER</span>
						<div class="hod-value hod-mono">
							{#if drawerDaServer}
								{#await drawerDaServer then srv}
									{srv?.name ?? '—'}
								{/await}
							{:else if o.paymentStatus === 'paid'}
								Auto-alocare în curs
							{:else}
								—
							{/if}
						</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>STATUS CONT</span>
						<div class="hod-value">
							<span class="hod-pill hod-pill-sm" data-tone={acctStatus.tone}>
								<span class="hod-dot"></span>{acctStatus.text}
							</span>
						</div>
					</div>
				</div>
			</section>

			<!-- PLATĂ -->
			<section class="hod-section">
				<div class="hod-section-label">PLATĂ</div>
				<div class="hod-grid-2">
					<div class="hod-input-block hod-readonly">
						<span>METODĂ</span>
						<div class="hod-value">
							<CreditCardIcon size={14} />
							{methodLabel(o.paymentMethod)}
						</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>STATUS</span>
						<div class="hod-value">
							<span class="hod-pill hod-pill-sm" data-tone={paymentTone(o.paymentStatus)}>
								<span class="hod-dot"></span>{paymentLabel(o.paymentStatus).toUpperCase()}
							</span>
						</div>
					</div>
				</div>

				<!-- Line items box -->
				<div class="hod-items">
					{#each visItems as it (it.id)}
						<div class="hod-item-row">
							<span class="hod-item-label">{it.label}</span>
							<span class="hod-item-value"
								>{fmtMoney(it.unitPriceCents * it.quantity, o.productCurrency)}</span
							>
						</div>
					{/each}
					{#if visItems.length > 0}
						<div class="hod-item-row">
							<span class="hod-item-label">TVA 19%</span>
							<span class="hod-item-value">{fmtMoney(tvaCents, o.productCurrency)}</span>
						</div>
					{/if}
					<div class="hod-item-row hod-item-total">
						<span class="hod-item-label">
							{o.paymentStatus === 'paid' ? 'Total achitat' : 'Total de plată'}
						</span>
						<span class="hod-item-value">{fmtMoney(totalCents, o.productCurrency)}</span>
					</div>
				</div>
			</section>

			<!-- ISTORIC -->
			<section class="hod-section">
				<div class="hod-section-label">ISTORIC</div>
				<ol class="hod-timeline">
					{#each buildHistory(o, null) as h, idx (idx)}
						<li class="hod-timeline-step" data-kind={h.kind}>
							<span class="hod-timeline-dot"></span>
							<div class="hod-timeline-body">
								<div class="hod-timeline-title">{h.label}</div>
								<div class="hod-timeline-meta">
									{fmtRelative(h.at)}{h.meta ? ` · ${h.meta}` : ''}
								</div>
							</div>
						</li>
					{/each}
				</ol>
			</section>

			<!-- Provisioning form (only when openProvisionForm was called) -->
			{#if o.paymentStatus === 'paid' && !o.hostingAccountId && lastProvisionInitId === o.id}
				<section class="hod-section" id="drawer-provisioning">
					<div class="hod-section-label">PROVISIONING DA</div>

					{#if serversPromise}
						{#await serversPromise then servers}
							<div class="hod-grid-2">
								<label class="hod-input-block">
									<span>SERVER</span>
									<select bind:value={provServerId}>
										<option value="">— alege —</option>
										{#each servers as srv (srv.id)}
											<option value={srv.id}>{srv.name}</option>
										{/each}
									</select>
								</label>
								<label class="hod-input-block">
									<span>PACHET DA (OPȚIONAL)</span>
									<input type="text" bind:value={provPackageId} placeholder="ex: standard" />
								</label>
								<label class="hod-input-block">
									<span>USERNAME DA</span>
									<input type="text" bind:value={provUsername} placeholder="ex: andreim" />
								</label>
								<label class="hod-input-block">
									<span>DOMENIU PRIMAR</span>
									<input type="text" bind:value={provDomain} placeholder="ex: domeniu.ro" />
								</label>
								<label class="hod-input-block">
									<span>PAROLĂ</span>
									<div class="hod-pwd-row">
										<input type="text" bind:value={provPassword} />
										<button
											type="button"
											class="hod-btn hod-btn-ghost"
											onclick={regeneratePassword}
										>
											<SparklesIcon size={12} /> Regen
										</button>
										<button type="button" class="hod-btn hod-btn-ghost" onclick={copyPassword}>
											<CopyIcon size={12} /> {provPwdCopied ? 'Copiat' : 'Copiază'}
										</button>
									</div>
								</label>
								<label class="hod-input-block hod-grid-span-2">
									<span>NOTE INTERNE (OPȚIONAL)</span>
									<textarea rows="2" bind:value={provNotes} maxlength="500"></textarea>
								</label>
							</div>

							<div class="hod-accept-foot">
								<button class="hod-btn hod-btn-ghost" onclick={() => (openOrder = null)}>
									Anulează
								</button>
								<button
									class="hod-btn hod-btn-primary"
									disabled={provisioning}
									onclick={() => submitProvision(o.id)}
								>
									<HardDriveIcon size={14} /> Provisionează
								</button>
							</div>
						{/await}
					{/if}
				</section>
			{/if}
		</div>

		<!-- Sticky footer action bar -->
		<footer class="hod-drawer-foot">
			{#if o.paymentStatus === 'pending'}
				<a
					class="hod-btn hod-btn-ghost"
					href={`mailto:${o.contactEmail}?subject=${encodeURIComponent('Comanda ' + displayOrderId(o.orderNumber, o.id))}`}
				>
					<MailIcon size={14} /> Email client
				</a>
				<button class="hod-btn hod-btn-primary" onclick={() => openAcceptDialog(o)}>
					<CheckCircle2Icon size={14} /> Marchează plătit
				</button>
			{:else if o.paymentStatus === 'failed'}
				<a
					class="hod-btn hod-btn-ghost"
					href={`mailto:${o.contactEmail}?subject=${encodeURIComponent('Comanda ' + displayOrderId(o.orderNumber, o.id))}`}
				>
					<MailIcon size={14} /> Email client
				</a>
			{:else}
				<!-- Paid or refunded -->
				<a
					class="hod-btn hod-btn-ghost"
					href={`/${page.params.tenant}/invoices?clientEmail=${encodeURIComponent(o.contactEmail)}`}
				>
					<FileTextIcon size={14} /> Factură fiscală
				</a>
				<button
					class="hod-btn hod-btn-ghost"
					onclick={() => toast.info('Refund prin Stripe — funcție în curând')}
				>
					<RotateCcwIcon size={14} /> Refund
				</button>
				<a
					class="hod-btn hod-btn-ghost"
					href={`mailto:${o.contactEmail}?subject=${encodeURIComponent('Comanda ' + displayOrderId(o.orderNumber, o.id))}`}
				>
					<MailIcon size={14} /> Email client
				</a>
				{#if o.hostingAccountId}
					<a
						class="hod-btn hod-btn-primary"
						href={`/${page.params.tenant}/hosting/accounts/${o.hostingAccountId}`}
					>
						<ExternalLinkIcon size={14} /> Vezi cont
					</a>
				{:else}
					<button class="hod-btn hod-btn-primary" onclick={() => openOrderAtProvision(o)}>
						<SparklesIcon size={14} /> Forțează provisionare
					</button>
				{/if}
			{/if}
		</footer>
	</div>
{/if}

<style>
	/* ===== Tokens ===== */
	/* Variables must be available on .hod-page (the main page container)
	   AND on .hod-drawer + .hod-drawer-back which are position:fixed and live
	   OUTSIDE .hod-page in the DOM tree (Svelte renders them at the same
	   level as <body> child). Without this, var(--hod-bg) resolves to nothing
	   on the drawer and it becomes transparent. */
	.hod-page,
	.hod-drawer,
	.hod-drawer-back {
		--hod-bg: #ffffff;
		--hod-bg-soft: #f9fafb;
		--hod-border: #e5e7eb;
		--hod-border-strong: #d1d5db;
		--hod-text: #111827;
		--hod-text-muted: #6b7280;
		--hod-text-faint: #9ca3af;
		--hod-accent: #2563eb;
		--hod-accent-soft: rgba(37, 99, 235, 0.08);
		--hod-ok: #10b981;
		--hod-warn: #f59e0b;
		--hod-bad: #ef4444;
		--hod-radius: 8px;
		--hod-radius-sm: 6px;
	}
	.hod-page {
		padding: 24px;
		color: var(--hod-text);
		font-size: 14px;
	}
	.hod-loading,
	.hod-empty {
		padding: 48px 24px;
		text-align: center;
		color: var(--hod-text-faint);
	}
	.hod-empty p {
		margin: 8px 0 0;
	}

	/* ===== Hero ===== */
	.hod-hero {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		margin-bottom: 16px;
		gap: 16px;
		flex-wrap: wrap;
	}
	.hod-hero h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 700;
	}
	.hod-hero p {
		margin: 4px 0 0;
		color: var(--hod-text-muted);
		font-size: 13px;
	}
	.hod-hero-actions {
		display: flex;
		gap: 8px;
	}

	/* ===== Buttons ===== */
	.hod-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: var(--hod-radius-sm);
		border: 1px solid var(--hod-border);
		background: var(--hod-bg);
		color: var(--hod-text);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.12s ease;
	}
	.hod-btn:hover {
		background: var(--hod-bg-soft);
		border-color: var(--hod-border-strong);
	}
	.hod-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.hod-btn-primary {
		background: var(--hod-accent);
		color: #fff;
		border-color: var(--hod-accent);
	}
	.hod-btn-primary:hover {
		filter: brightness(0.95);
	}
	.hod-btn-bad {
		background: var(--hod-bad);
		color: #fff;
		border-color: var(--hod-bad);
	}
	.hod-btn-ghost {
		background: transparent;
	}

	/* ===== KPI strip ===== */
	.hod-kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
		margin-bottom: 20px;
	}
	.hod-kpi {
		display: flex;
		background: var(--hod-bg);
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius);
		overflow: hidden;
	}
	.hod-kpi-stripe {
		width: 4px;
		background: var(--hod-text-faint);
	}
	.hod-kpi[data-tone='ok'] .hod-kpi-stripe {
		background: var(--hod-ok);
	}
	.hod-kpi[data-tone='warn'] .hod-kpi-stripe {
		background: var(--hod-warn);
	}
	.hod-kpi[data-tone='bad'] .hod-kpi-stripe {
		background: var(--hod-bad);
	}
	.hod-kpi[data-tone='info'] .hod-kpi-stripe {
		background: var(--hod-accent);
	}
	.hod-kpi-body {
		flex: 1;
		padding: 12px 14px;
	}
	.hod-kpi-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.05em;
		color: var(--hod-text-faint);
	}
	.hod-kpi-value {
		font-size: 22px;
		font-weight: 700;
		color: var(--hod-text);
		margin-top: 4px;
	}
	.hod-kpi-foot {
		font-size: 11px;
		color: var(--hod-text-muted);
		margin-top: 4px;
	}

	/* ===== Tabs ===== */
	.hod-tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--hod-border);
		margin-bottom: 12px;
	}
	.hod-tabs button {
		padding: 10px 14px;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--hod-text-muted);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}
	.hod-tabs button.active {
		color: var(--hod-accent);
		border-bottom-color: var(--hod-accent);
	}
	.hod-tab-count {
		background: var(--hod-bg-soft);
		color: var(--hod-text-muted);
		padding: 2px 6px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 600;
	}
	.hod-tabs button.active .hod-tab-count {
		background: var(--hod-accent-soft);
		color: var(--hod-accent);
	}

	/* ===== Filter row ===== */
	.hod-filters {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}
	.hod-search {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 220px;
		padding: 6px 10px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		background: var(--hod-bg);
		color: var(--hod-text-muted);
	}
	.hod-search input {
		flex: 1;
		border: 0;
		outline: 0;
		font-size: 13px;
		background: transparent;
		color: var(--hod-text);
	}
	.hod-filter-wrap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		background: var(--hod-bg);
		color: var(--hod-text-muted);
		cursor: pointer;
	}
	.hod-filter-wrap select {
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 13px;
		color: var(--hod-text);
		cursor: pointer;
		font-family: inherit;
		padding: 2px 0;
		appearance: none;
		-webkit-appearance: none;
		padding-right: 14px;
		background-image: linear-gradient(45deg, transparent 50%, var(--hod-text-faint) 50%),
			linear-gradient(135deg, var(--hod-text-faint) 50%, transparent 50%);
		background-position:
			calc(100% - 8px) 50%,
			calc(100% - 4px) 50%;
		background-size:
			4px 4px,
			4px 4px;
		background-repeat: no-repeat;
	}
	.hod-filter-wrap[data-disabled='true'] {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.hod-filter-wrap[data-disabled='true'] select {
		cursor: not-allowed;
	}
	/* ===== Table cell source line ===== */
	.hod-cell-source {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	/* ===== Cell: package + domain ===== */
	.hod-cell-package {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.hod-pkg-dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--hod-accent);
		flex-shrink: 0;
	}
	.hod-cell-domain {
		font-size: 12px;
		color: var(--hod-text);
		margin-top: 4px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	/* ===== STATUS CONT inline label (table cell, not a pill) ===== */
	.hod-acct-label {
		font-size: 12px;
		font-weight: 600;
	}
	.hod-acct-label[data-tone='ok'] {
		color: var(--hod-ok);
	}
	.hod-acct-label[data-tone='warn'] {
		color: var(--hod-warn);
	}
	.hod-acct-label[data-tone='bad'] {
		color: var(--hod-bad);
	}
	.hod-acct-label[data-tone='neutral'] {
		color: var(--hod-text-muted);
	}

	/* ===== Row actions ===== */
	.hod-actions-th {
		width: 1px; /* shrink-to-fit; the cell content drives the width */
	}
	.hod-actions-cell {
		white-space: nowrap;
	}
	.hod-row-actions {
		display: inline-flex;
		gap: 4px;
		justify-content: flex-end;
	}
	.hod-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--hod-radius-sm);
		border: 1px solid var(--hod-border);
		background: var(--hod-bg);
		color: var(--hod-text-muted);
		cursor: pointer;
		text-decoration: none;
		transition:
			background 0.12s,
			color 0.12s,
			border-color 0.12s;
	}
	.hod-icon-btn:hover {
		background: var(--hod-bg-soft);
		color: var(--hod-text);
		border-color: var(--hod-border-strong);
	}
	.hod-icon-btn:focus-visible {
		outline: 2px solid var(--hod-accent);
		outline-offset: 1px;
	}

	/* ===== Table ===== */
	.hod-table-wrap {
		background: var(--hod-bg);
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius);
		overflow: hidden;
	}
	.hod-table {
		width: 100%;
		border-collapse: collapse;
	}
	.hod-table th {
		text-align: left;
		padding: 12px 14px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.05em;
		color: var(--hod-text-faint);
		background: var(--hod-bg-soft);
		border-bottom: 1px solid var(--hod-border);
	}
	.hod-table th.num,
	.hod-table td.num {
		text-align: right;
	}
	.hod-table td {
		padding: 12px 14px;
		border-bottom: 1px solid var(--hod-border);
		vertical-align: top;
	}
	.hod-table tbody tr {
		cursor: pointer;
	}
	.hod-table tbody tr:hover {
		background: var(--hod-bg-soft);
	}
	.hod-table tbody tr:last-child td {
		border-bottom: 0;
	}
	.hod-cell-strong {
		font-weight: 600;
		color: var(--hod-text);
	}
	.hod-cell-muted {
		font-size: 12px;
		color: var(--hod-text-muted);
		margin-top: 2px;
	}
	.hod-cell-faint {
		font-size: 11px;
		color: var(--hod-text-faint);
		margin-top: 2px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	/* ===== Status pills ===== */
	.hod-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.hod-pill-sm {
		padding: 2px 8px;
		font-size: 10px;
	}
	.hod-pill[data-tone='ok'] {
		background: rgba(16, 185, 129, 0.12);
		color: var(--hod-ok);
	}
	.hod-pill[data-tone='warn'] {
		background: rgba(245, 158, 11, 0.12);
		color: var(--hod-warn);
	}
	.hod-pill[data-tone='bad'] {
		background: rgba(239, 68, 68, 0.12);
		color: var(--hod-bad);
	}
	.hod-pill[data-tone='neutral'] {
		background: rgba(107, 114, 128, 0.12);
		color: var(--hod-text-muted);
	}
	.hod-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: currentColor;
	}

	/* ===== Drawer ===== */
	.hod-drawer-back {
		position: fixed;
		inset: 0;
		background: rgba(17, 24, 39, 0.4);
		border: 0;
		cursor: pointer;
		z-index: 99;
	}
	.hod-drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 580px;
		max-width: 100vw;
		background: var(--hod-bg);
		border-left: 1px solid var(--hod-border);
		z-index: 100;
		display: flex;
		flex-direction: column;
		box-shadow: -16px 0 40px -16px rgba(17, 24, 39, 0.2);
	}
	.hod-drawer-head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid var(--hod-border);
	}
	.hod-drawer-head-icon {
		width: 32px;
		height: 32px;
		border-radius: var(--hod-radius-sm);
		background: var(--hod-accent-soft);
		color: var(--hod-accent);
		display: grid;
		place-items: center;
	}
	.hod-drawer-head-text {
		flex: 1;
	}
	.hod-drawer-title {
		font-size: 16px;
		font-weight: 700;
		color: var(--hod-text);
	}
	.hod-drawer-subtitle {
		font-size: 12px;
		color: var(--hod-text-muted);
		margin-top: 2px;
	}
	.hod-drawer-close {
		width: 32px;
		height: 32px;
		border-radius: var(--hod-radius-sm);
		border: 0;
		background: transparent;
		color: var(--hod-text-muted);
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.hod-drawer-close:hover {
		background: var(--hod-bg-soft);
		color: var(--hod-text);
	}
	.hod-drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
	}

	/* ===== Banner ===== */
	.hod-banner {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 12px 14px;
		border-radius: var(--hod-radius-sm);
		margin-bottom: 16px;
		font-size: 13px;
	}
	.hod-banner-bad {
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: var(--hod-text);
	}
	.hod-banner > div {
		flex: 1;
	}
	.hod-banner strong {
		color: var(--hod-bad);
	}

	/* ===== Sections ===== */
	.hod-section {
		margin-bottom: 20px;
	}
	.hod-section-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--hod-text-faint);
		text-transform: uppercase;
		margin-bottom: 8px;
	}
	.hod-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.hod-grid-span-2 {
		grid-column: span 2;
	}
	.hod-input-block {
		display: flex;
		flex-direction: column;
		padding: 8px 12px 10px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		background: var(--hod-bg);
	}
	.hod-input-block > span {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--hod-text-faint);
		margin-bottom: 4px;
	}
	.hod-input-block input,
	.hod-input-block select,
	.hod-input-block textarea {
		border: 0;
		outline: 0;
		font-size: 14px;
		padding: 0;
		background: transparent;
		color: var(--hod-text);
		font-family: inherit;
	}
	.hod-input-block textarea {
		resize: vertical;
		min-height: 36px;
	}
	.hod-readonly .hod-value {
		font-size: 14px;
		font-weight: 500;
		color: var(--hod-text);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.hod-link {
		color: var(--hod-accent);
	}
	.hod-mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 13px;
	}

	/* ===== Line items box ===== */
	.hod-items {
		margin-top: 10px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		padding: 12px 14px;
		background: var(--hod-bg);
	}
	.hod-item-row {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		font-size: 13px;
		color: var(--hod-text);
	}
	.hod-item-total {
		border-top: 1px solid var(--hod-border);
		margin-top: 6px;
		padding-top: 10px;
		font-weight: 700;
	}
	.hod-item-total .hod-item-value {
		color: var(--hod-accent);
		font-size: 18px;
	}

	/* ===== Timeline ===== */
	.hod-timeline {
		list-style: none;
		padding: 0;
		margin: 0;
		position: relative;
	}
	.hod-timeline::before {
		content: '';
		position: absolute;
		left: 4px;
		top: 6px;
		bottom: 6px;
		width: 2px;
		background: var(--hod-border);
	}
	.hod-timeline-step {
		display: flex;
		gap: 10px;
		padding: 4px 0 12px;
		position: relative;
	}
	.hod-timeline-dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: var(--hod-text-faint);
		margin-top: 4px;
		z-index: 1;
		box-shadow: 0 0 0 3px var(--hod-bg);
	}
	.hod-timeline-step[data-kind='paid'] .hod-timeline-dot,
	.hod-timeline-step[data-kind='provisioned'] .hod-timeline-dot {
		background: var(--hod-ok);
	}
	.hod-timeline-step[data-kind='failed'] .hod-timeline-dot {
		background: var(--hod-bad);
	}
	.hod-timeline-step[data-kind='provisioning'] .hod-timeline-dot {
		background: var(--hod-accent);
	}
	.hod-timeline-step[data-kind='refunded'] .hod-timeline-dot {
		background: var(--hod-text-muted);
	}
	.hod-timeline-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--hod-text);
	}
	.hod-timeline-meta {
		font-size: 12px;
		color: var(--hod-text-muted);
		margin-top: 2px;
	}

	/* ===== Accept-payment subform ===== */
	.hod-accept {
		background: var(--hod-bg-soft);
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius);
		padding: 16px;
		margin-bottom: 20px;
	}
	.hod-accept-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
	}
	.hod-accept-head h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
	}
	.hod-tab-group {
		display: flex;
		gap: 6px;
		margin-bottom: 12px;
	}
	.hod-tab-group button {
		flex: 1;
		padding: 10px 8px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		background: var(--hod-bg);
		font-size: 12px;
		font-weight: 500;
		color: var(--hod-text-muted);
		cursor: pointer;
		display: inline-flex;
		gap: 6px;
		align-items: center;
		justify-content: center;
	}
	.hod-tab-group button.active {
		background: var(--hod-bg);
		border-color: var(--hod-accent);
		color: var(--hod-accent);
		box-shadow: inset 0 0 0 1px var(--hod-accent);
	}
	.hod-check {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 13px;
		color: var(--hod-text);
		margin-top: 10px;
	}
	.hod-accept-foot {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 14px;
	}
	.hod-accept-context {
		flex: 1;
		font-size: 12px;
		color: var(--hod-text-muted);
	}

	/* ===== Provisioning pwd row ===== */
	.hod-pwd-row {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.hod-pwd-row input {
		flex: 1;
	}

	/* ===== Sticky footer ===== */
	.hod-drawer-foot {
		display: flex;
		gap: 8px;
		padding: 14px 20px;
		border-top: 1px solid var(--hod-border);
		background: var(--hod-bg);
		flex-wrap: wrap;
	}

	/* ===== Mobile ===== */
	@media (max-width: 640px) {
		.hod-drawer {
			width: 100vw;
		}
		.hod-grid-2 {
			grid-template-columns: 1fr;
		}
		.hod-kpis {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
