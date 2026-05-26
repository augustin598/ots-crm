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

	type ActiveTab = 'all' | 'activity' | 'pending' | 'failed' | 'refunded';

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
			if (activeTab === 'activity') {
				const touched =
					(o.createdAt && new Date(o.createdAt).getTime() >= today.getTime()) ||
					(o.paidAt && new Date(o.paidAt).getTime() >= today.getTime()) ||
					(o.acceptedAt && new Date(o.acceptedAt).getTime() >= today.getTime());
				if (!touched) return false;
			}
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

		const activityToday = list.filter((o) => {
			const c = o.createdAt && new Date(o.createdAt).getTime() >= today.getTime();
			const p = o.paidAt && new Date(o.paidAt).getTime() >= today.getTime();
			const a = o.acceptedAt && new Date(o.acceptedAt).getTime() >= today.getTime();
			return c || p || a;
		}).length;

		return {
			total: list.length,
			createdToday,
			createdYesterday,
			activityToday,
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
				aria-selected={activeTab === 'activity'}
				class:active={activeTab === 'activity'}
				onclick={() => (activeTab = 'activity')}
			>
				Activitate <span class="hod-tab-count">{c.activityToday}</span>
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
			<select class="hod-filter-select" bind:value={filterPackage}>
				<option value="">📦 Pachet — toate</option>
				{#each productOptions as [id, name] (id)}
					<option value={id}>{name}</option>
				{/each}
			</select>
			<select class="hod-filter-select" bind:value={filterMethod}>
				<option value="all">💳 Metodă — toate</option>
				<option value="card">Card</option>
				<option value="op">Ordin de plată</option>
				<option value="paypal">PayPal</option>
				<option value="revolut">Revolut</option>
			</select>
			<select class="hod-filter-select" disabled title="În curând">
				<option>📅 Perioadă</option>
			</select>
			<select class="hod-filter-select" disabled title="În curând">
				<option>📆 Data</option>
			</select>
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
							<th>PACHET</th>
							<th>METODĂ</th>
							<th class="num">SUMĂ</th>
							<th>STATUS</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as o (o.id)}
							<tr onclick={() => openDrawer(o)}>
								<td>
									<div class="hod-cell-strong">{displayOrderId(o.orderNumber, o.id)}</div>
									<div class="hod-cell-muted">{fmtRelative(o.createdAt)}</div>
									<div class="hod-cell-faint">📄 /{o.source}</div>
								</td>
								<td>
									<div class="hod-cell-strong">{o.contactName}</div>
									<div class="hod-cell-muted">{o.contactEmail}</div>
								</td>
								<td>
									<div class="hod-cell-strong">{o.productName ?? '—'}</div>
									<div class="hod-cell-muted">{billingCycleLabel(o.productBillingCycle)}</div>
								</td>
								<td>
									<div class="hod-cell-strong">{methodLabel(o.paymentMethod)}</div>
								</td>
								<td class="num">
									<div class="hod-cell-strong">
										{o.paidAmountCents != null
											? fmtMoney(o.paidAmountCents, o.productCurrency)
											: o.productPrice != null
												? fmtMoney(o.productPrice, o.productCurrency)
												: '—'}
									</div>
									<div class="hod-cell-faint">incl. TVA 19%</div>
								</td>
								<td>
									<span class="hod-pill" data-tone={paymentTone(o.paymentStatus)}>
										<span class="hod-dot"></span>{paymentLabel(o.paymentStatus).toUpperCase()}
									</span>
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
	{@const daServer = o.productDaServerId ? getDAServer(o.productDaServerId) : null}

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
							{#if daServer}
								{#await daServer then srv}
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
					<!-- placeholder — Task 17 fills this in -->
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
	/* ===== shared hst-* design language, page-scoped ===== */
	.hst-page {
		font-family: 'Inter', system-ui, -apple-system, sans-serif;
		color: #0f172a;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.hst-loading,
	.hst-empty {
		padding: 48px 24px;
		text-align: center;
		color: #94a3b8;
		font-size: 13px;
	}
	.hst-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}
	.hst-empty :global(svg) {
		color: #cbd5e1;
	}

	/* Hero */
	.hst-hero {
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
	.btn-primary,
	.btn-secondary,
	.btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
		text-decoration: none;
	}
	.btn-primary {
		background: #1877f2;
		color: white;
		border: none;
	}
	.btn-primary:hover {
		background: #0d5cc7;
	}
	.btn-secondary {
		background: white;
		color: #475569;
		border: 1px solid #d5dbe5;
	}
	.btn-secondary:hover:not(:disabled) {
		border-color: #1877f2;
		color: #1877f2;
	}
	.btn-secondary.small {
		padding: 5px 10px;
		font-size: 11.5px;
	}
	.btn-ghost {
		background: transparent;
		color: #475569;
		border: none;
	}
	.btn-ghost:hover:not(:disabled) {
		background: #f4f6fa;
		color: #0f172a;
	}
	.btn-ghost.danger {
		color: #b91c1c;
	}
	.btn-ghost.danger:hover {
		background: #fef2f2;
	}
	.btn-primary:disabled,
	.btn-secondary:disabled,
	.btn-ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* KPIs */
	.hst-kpis {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
	}
	@media (max-width: 1200px) {
		.hst-kpis {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	@media (max-width: 640px) {
		.hst-kpis {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	.dash-kpi {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.dash-kpi-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dash-kpi-icon {
		width: 26px;
		height: 26px;
		border-radius: 7px;
		display: grid;
		place-items: center;
	}
	.dash-kpi-label {
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #94a3b8;
	}
	.dash-kpi-value {
		font-size: 26px;
		font-weight: 800;
		color: #0f172a;
		letter-spacing: -0.02em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.dash-kpi-foot {
		font-size: 11px;
		color: #94a3b8;
	}

	/* Toolbar */
	.hst-toolbar {
		display: flex;
		gap: 6px;
		align-items: center;
		flex-wrap: wrap;
	}
	.hst-search {
		flex: 0 0 280px;
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
		min-width: 0;
	}
	.hst-filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
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
	.hst-toolbar-sep {
		width: 1px;
		height: 22px;
		background: #e5e9f0;
		margin: 0 4px;
	}
	.hst-toolbar-spacer {
		flex: 1;
	}
	.hst-view-toggle {
		display: flex;
		gap: 2px;
		background: white;
		border: 1px solid #d5dbe5;
		border-radius: 8px;
		padding: 3px;
	}
	.hst-view-toggle button {
		padding: 5px 10px;
		border-radius: 5px;
		border: none;
		background: transparent;
		color: #475569;
		font-family: inherit;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.hst-view-toggle button.active {
		background: #1877f2;
		color: white;
	}

	/* Status pills */
	.hst-status-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex-shrink: 0;
		background: rgba(148, 163, 184, 0.18);
		color: #475569;
	}
	.hst-status-pill[data-status='paid'] {
		background: rgba(16, 185, 129, 0.14);
		color: #047857;
	}
	.hst-status-pill[data-status='pending'] {
		background: rgba(245, 158, 11, 0.14);
		color: #b45309;
	}
	.hst-status-pill[data-status='failed'] {
		background: rgba(239, 68, 68, 0.14);
		color: #b91c1c;
	}
	.hst-status-pill[data-status='refunded'] {
		background: rgba(99, 102, 241, 0.14);
		color: #4338ca;
	}
	.hst-status-pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}

	/* Order cards grid */
	.hst-order-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
		gap: 12px;
	}
	.hst-order-card {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.hst-order-card.warning {
		border-color: #fecaca;
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.06);
	}
	.hst-order-card.success {
		border-color: #bbf7d0;
	}
	.hst-order-card.pending {
		border-color: #fde68a;
	}
	.hst-order-card-head {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}
	.hst-order-card-icon {
		width: 38px;
		height: 38px;
		border-radius: 9px;
		background: linear-gradient(135deg, #1877f2, #0d5cc7);
		color: white;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.hst-order-card-icon[data-payment='paid'] {
		background: linear-gradient(135deg, #10b981, #047857);
	}
	.hst-order-card-icon[data-payment='pending'] {
		background: linear-gradient(135deg, #f59e0b, #d97706);
	}
	.hst-order-card-icon[data-payment='failed'] {
		background: linear-gradient(135deg, #ef4444, #b91c1c);
	}
	.hst-order-card-text {
		flex: 1;
		min-width: 0;
	}
	.hst-order-card-name {
		font-weight: 700;
		font-size: 14px;
		color: #0f172a;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hst-order-card-meta {
		font-size: 11.5px;
		color: #94a3b8;
		margin-top: 2px;
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		align-items: center;
	}
	.hst-order-amount {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding-bottom: 10px;
		border-bottom: 1px solid #f1f5f9;
	}
	.hst-order-amount strong {
		font-size: 20px;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.hst-order-amount span {
		font-size: 11.5px;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
	}

	/* Pipeline indicator */
	.hst-pipeline {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10.5px;
		color: #94a3b8;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.hst-pipeline-step {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.hst-pipeline-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #cbd5e1;
		flex-shrink: 0;
	}
	.hst-pipeline-step.done {
		color: #047857;
	}
	.hst-pipeline-step.done .hst-pipeline-dot {
		background: #10b981;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
	}
	.hst-pipeline-step.waiting {
		color: #b45309;
	}
	.hst-pipeline-step.waiting .hst-pipeline-dot {
		background: #f59e0b;
		animation: hst-pulse 2s ease-in-out infinite;
	}
	.hst-pipeline-step.failed {
		color: #b91c1c;
	}
	.hst-pipeline-step.failed .hst-pipeline-dot {
		background: #ef4444;
	}
	.hst-pipeline-arrow {
		flex: 1;
		height: 1px;
		background: #e5e9f0;
		min-width: 8px;
	}
	@keyframes hst-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.hst-order-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-top: 10px;
		border-top: 1px solid #f1f5f9;
		font-size: 11px;
		color: #94a3b8;
	}
	.hst-order-foot-info {
		flex: 1;
		min-width: 0;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 11.5px;
		color: #475569;
	}
	.hst-order-foot-info :global(.muted) {
		font-family: inherit;
		color: #94a3b8;
		font-style: italic;
	}
	.hst-order-actions {
		display: flex;
		gap: 4px;
	}

	/* Table */
	.hst-table-wrap {
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
	.hst-table tbody tr {
		cursor: pointer;
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
		font-weight: 700;
		color: #0f172a;
	}
	.hst-host-sub {
		font-size: 11px;
		color: #94a3b8;
		margin-top: 2px;
	}
	.hst-mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 12px;
		color: #475569;
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
	.muted {
		color: #94a3b8;
		font-style: italic;
	}

	/* Drawer */
	.hst-drawer-back {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.4);
		z-index: 79;
		backdrop-filter: blur(2px);
		border: none;
		padding: 0;
		cursor: default;
	}
	.hst-drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 640px;
		max-width: 100vw;
		background: white;
		z-index: 80;
		display: flex;
		flex-direction: column;
		box-shadow: -12px 0 32px rgba(15, 23, 42, 0.15);
		animation: slideIn 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	@keyframes slideIn {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}
	.hst-drawer-head {
		padding: 16px 22px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.hst-drawer-title {
		font-weight: 700;
		font-size: 16px;
		color: #0f172a;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hst-drawer-close {
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
	.hst-drawer-close:hover {
		background: #fef2f2;
		color: #b91c1c;
		border-color: #fecaca;
	}
	.hst-drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 18px 22px 32px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.hst-drawer-body section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.hst-drawer-body h3 {
		font-size: 11px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0;
	}
	.hst-drawer-body h4 {
		font-size: 13px;
		font-weight: 700;
		color: #0f172a;
		margin: 0;
	}
	.hst-kv {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 14px;
		margin: 0;
		font-size: 12.5px;
	}
	.hst-kv dt {
		color: #94a3b8;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.hst-kv dd {
		margin: 0;
		color: #0f172a;
		font-weight: 500;
		word-break: break-word;
	}
	.hst-kv dd a {
		color: #1877f2;
		text-decoration: none;
	}
	.hst-kv dd a:hover {
		text-decoration: underline;
	}
	.hst-message {
		background: #f4f6fa;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 12px;
		color: #475569;
		white-space: pre-wrap;
		margin: 0;
		font-family: inherit;
	}
	.hst-warning {
		display: flex;
		align-items: center;
		gap: 6px;
		background: #fffbeb;
		color: #b45309;
		border: 1px solid #fde68a;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 12px;
		font-weight: 500;
		margin: 0;
	}
	.hst-funnel-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		font-size: 12px;
		color: #475569;
	}
	.hst-accept-form {
		background: #f9fafc;
		border: 1px solid #e5e9f0;
		border-radius: 10px;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.hst-accept-form label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #475569;
		font-weight: 600;
	}
	.hst-accept-form label.hst-accept-check {
		flex-direction: row;
		align-items: center;
		gap: 8px;
		font-weight: 500;
		color: #0f172a;
	}
	.hst-accept-form input[type='text'],
	.hst-accept-form textarea,
	.hst-accept-form select {
		font-family: inherit;
		font-size: 13px;
		border: 1px solid #d5dbe5;
		border-radius: 7px;
		padding: 8px 10px;
		background: white;
		color: #0f172a;
		outline: none;
	}
	.hst-accept-form input:focus,
	.hst-accept-form textarea:focus,
	.hst-accept-form select:focus {
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.hst-accept-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.hst-help {
		display: block;
		margin-top: 6px;
		color: #64748b;
		font-size: 12px;
		line-height: 1.45;
	}

	/* Provisioning form — mirrors accept form but with row layout for server/package */
	.hst-prov-form {
		background: #f9fafc;
		border: 1px solid #e5e9f0;
		border-radius: 10px;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.hst-prov-form label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #475569;
		font-weight: 600;
	}
	.hst-prov-form small {
		font-size: 10.5px;
		font-weight: 500;
		color: #94a3b8;
		line-height: 1.4;
	}
	.hst-prov-form input[type='text'],
	.hst-prov-form textarea,
	.hst-prov-form select {
		font-family: inherit;
		font-size: 13px;
		border: 1px solid #d5dbe5;
		border-radius: 7px;
		padding: 8px 10px;
		background: white;
		color: #0f172a;
		outline: none;
		min-width: 0;
	}
	.hst-prov-form input:focus,
	.hst-prov-form textarea:focus,
	.hst-prov-form select:focus {
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.hst-prov-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.hst-prov-input-with-action {
		display: flex;
		gap: 6px;
		align-items: stretch;
	}
	.hst-prov-input-with-action input {
		flex: 1;
		min-width: 0;
	}
	.hst-prov-actions {
		display: flex;
		justify-content: flex-end;
		padding-top: 4px;
	}
</style>
