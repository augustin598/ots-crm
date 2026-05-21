<script lang="ts">
	import {
		getHostingOrders,
		updateHostingInquiryStatus,
		deleteHostingInquiry,
		acceptHostingOrderPayment,
		retryDaProvisioning,
		type HostingOrderRow
	} from '$lib/remotes/hosting-inquiries.remote';
	import { toast } from 'svelte-sonner';
	import { focusTrap } from '$lib/actions/focus-trap';
	import SearchIcon from '@lucide/svelte/icons/search';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
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
	import PlayIcon from '@lucide/svelte/icons/play';

	type FunnelStatus = 'all' | 'new' | 'contacted' | 'converted' | 'discarded' | 'abandoned';
	type PaymentFilter = 'all' | 'paid' | 'pending' | 'failed';
	type MethodFilter = 'all' | 'card' | 'op' | 'paypal' | 'revolut';

	let ordersPromise = $state(getHostingOrders());

	async function refresh() {
		ordersPromise = getHostingOrders();
	}

	// ----- view state -----
	let view = $state<'grid' | 'table'>('grid');
	let funnel = $state<FunnelStatus>('all');
	let payment = $state<PaymentFilter>('all');
	let method = $state<MethodFilter>('all');
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

	function openAcceptDialog(o: HostingOrderRow) {
		acceptOpen = true;
		acceptMethod = (o.paymentMethod as 'op' | 'card' | 'paypal' | 'revolut' | null) ?? 'op';
		if (acceptMethod === 'card' as string) acceptMethod = 'op';
		const guessed = o.productPrice ?? 0;
		acceptAmount = guessed > 0 ? String(guessed) : '';
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

	async function handleRetry(o: HostingOrderRow) {
		busyId = o.id;
		try {
			const r = await retryDaProvisioning(o.id);
			if (r.ok) {
				toast.success(
					r.created
						? `Cont DA creat: ${r.daUsername}`
						: `Cont DA existent: ${r.daUsername}`
				);
				await refresh();
			} else {
				toast.error(`Provisioning eșuat: ${r.error}`);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			busyId = null;
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
		return list.filter((o) => {
			if (funnel !== 'all' && o.status !== funnel) return false;
			if (payment !== 'all' && o.paymentStatus !== payment) return false;
			if (method !== 'all' && o.paymentMethod !== method) return false;
			if (search) {
				const q = search.toLowerCase();
				const hay = [
					o.contactName,
					o.contactEmail,
					o.companyName ?? '',
					o.vatNumber ?? '',
					o.productName ?? '',
					o.daDomain ?? '',
					o.daUsername ?? ''
				].join(' ').toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}

	function counts(list: HostingOrderRow[]) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
		const paidToday = list.filter(
			(o) => o.paidAt && new Date(o.paidAt).getTime() >= today.getTime()
		).length;
		const revenueMonth = list
			.filter((o) => o.paidAt && new Date(o.paidAt).getTime() >= startOfMonth.getTime())
			.reduce((a, o) => a + (o.paidAmountCents ?? 0), 0);
		const pendingPayment = list.filter((o) => o.paymentStatus === 'pending').length;
		const failedPayment = list.filter((o) => o.paymentStatus === 'failed').length;
		const provisioningPending = list.filter(
			(o) => o.paymentStatus === 'paid' && !o.hostingAccountId
		).length;
		return {
			total: list.length,
			paidToday,
			revenueMonth,
			pendingPayment,
			failedPayment,
			provisioningPending
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

<div class="hst-page">
	{#await ordersPromise}
		<div class="hst-loading">Se încarcă comenzile…</div>
	{:then orders}
		{@const c = counts(orders)}
		{@const filtered = applyFilters(orders)}

		<div class="hst-hero">
			<div>
				<h1>Comenzi hosting</h1>
				<p>
					{c.total} comenzi · {c.pendingPayment} așteaptă plată · {c.provisioningPending} așteaptă provisioning
				</p>
			</div>
			<div class="hst-hero-actions">
				<button class="btn-secondary" onclick={() => refresh()}>
					<RefreshCwIcon size={13} /> Refresh
				</button>
				<button class="btn-secondary" onclick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
					<DownloadIcon size={13} /> Export CSV
				</button>
				<a href="/pachete-hosting" target="_blank" class="btn-secondary">
					<ExternalLinkIcon size={13} /> Pagina publică
				</a>
			</div>
		</div>

		<div class="hst-kpis">
			<div class="dash-kpi primary">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(24,119,242,.12); color:#1877F2;">
						<ShoppingCartIcon size={13} />
					</div>
					<span class="dash-kpi-label">Total comenzi</span>
				</div>
				<div class="dash-kpi-value">{c.total}</div>
				<div class="dash-kpi-foot"><span class="dash-kpi-sub">toate sursele</span></div>
			</div>

			<div class="dash-kpi warn">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(245,158,11,.12); color:#f59e0b;">
						<ClockIcon size={13} />
					</div>
					<span class="dash-kpi-label">Așteaptă plată</span>
				</div>
				<div class="dash-kpi-value">{c.pendingPayment}</div>
				<div class="dash-kpi-foot"><span class="dash-kpi-sub">incl. ordin de plată</span></div>
			</div>

			<div class="dash-kpi success">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(16,185,129,.12); color:#10b981;">
						<CheckCircle2Icon size={13} />
					</div>
					<span class="dash-kpi-label">Plătite azi</span>
				</div>
				<div class="dash-kpi-value">{c.paidToday}</div>
				<div class="dash-kpi-foot"><span class="dash-kpi-sub">de la ora 00:00</span></div>
			</div>

			<div class="dash-kpi info">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(99,102,241,.12); color:#6366f1;">
						<TrendingUpIcon size={13} />
					</div>
					<span class="dash-kpi-label">Venit luna asta</span>
				</div>
				<div class="dash-kpi-value">{fmtMoney(c.revenueMonth, 'RON')}</div>
				<div class="dash-kpi-foot"><span class="dash-kpi-sub">comenzi confirmate</span></div>
			</div>

			<div class="dash-kpi danger">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(239,68,68,.12); color:#ef4444;">
						<AlertTriangleIcon size={13} />
					</div>
					<span class="dash-kpi-label">Plăți eșuate</span>
				</div>
				<div class="dash-kpi-value">{c.failedPayment}</div>
				<div class="dash-kpi-foot"><span class="dash-kpi-sub">necesită intervenție</span></div>
			</div>

			<div class="dash-kpi warn">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(245,158,11,.12); color:#f59e0b;">
						<HardDriveIcon size={13} />
					</div>
					<span class="dash-kpi-label">Fără cont DA</span>
				</div>
				<div class="dash-kpi-value">{c.provisioningPending}</div>
				<div class="dash-kpi-foot"><span class="dash-kpi-sub">plătite, neaprovizionate</span></div>
			</div>
		</div>

		<div class="hst-toolbar">
			<div class="hst-search">
				<SearchIcon size={13} />
				<input placeholder="Caută nume, email, CUI, domeniu…" bind:value={search} />
			</div>

			<button class="hst-filter-chip" class:active={funnel === 'all'} onclick={() => (funnel = 'all')}>
				Toate
			</button>
			<button class="hst-filter-chip" class:active={funnel === 'new'} onclick={() => (funnel = 'new')}>
				Noi
			</button>
			<button class="hst-filter-chip" class:active={funnel === 'contacted'} onclick={() => (funnel = 'contacted')}>
				Contactate
			</button>
			<button class="hst-filter-chip" class:active={funnel === 'converted'} onclick={() => (funnel = 'converted')}>
				Convertite
			</button>
			<button class="hst-filter-chip" class:active={funnel === 'discarded'} onclick={() => (funnel = 'discarded')}>
				Respinse
			</button>

			<span class="hst-toolbar-sep"></span>

			<button class="hst-filter-chip" class:active={payment === 'pending'} onclick={() => (payment = payment === 'pending' ? 'all' : 'pending')}>
				<ClockIcon size={11} /> Așteaptă plată
			</button>
			<button class="hst-filter-chip" class:active={payment === 'paid'} onclick={() => (payment = payment === 'paid' ? 'all' : 'paid')}>
				<CheckCircle2Icon size={11} /> Plătite
			</button>
			<button class="hst-filter-chip" class:active={payment === 'failed'} onclick={() => (payment = payment === 'failed' ? 'all' : 'failed')}>
				<AlertTriangleIcon size={11} /> Eșuate
			</button>

			<span class="hst-toolbar-sep"></span>

			<button class="hst-filter-chip" class:active={method === 'card'} onclick={() => (method = method === 'card' ? 'all' : 'card')}>
				<CreditCardIcon size={11} /> Card
			</button>
			<button class="hst-filter-chip" class:active={method === 'op'} onclick={() => (method = method === 'op' ? 'all' : 'op')}>
				<BanknoteIcon size={11} /> OP
			</button>

			<div class="hst-toolbar-spacer"></div>

			<div class="hst-view-toggle">
				<button class:active={view === 'grid'} onclick={() => (view = 'grid')} title="Carduri">
					<Columns3Icon size={13} />
				</button>
				<button class:active={view === 'table'} onclick={() => (view = 'table')} title="Tabel">
					<ListIcon size={13} />
				</button>
			</div>
		</div>

		{#if filtered.length === 0}
			<div class="hst-empty">
				<ShoppingCartIcon size={36} />
				<p>Nicio comandă pentru filtrele curente.</p>
			</div>
		{:else if view === 'grid'}
			<div class="hst-order-grid">
				{#each filtered as o (o.id)}
					{@const MIcon = methodIcon(o.paymentMethod)}
					<div class="hst-order-card" class:warning={o.paymentStatus === 'failed'} class:success={o.paymentStatus === 'paid' && o.hostingAccountId} class:pending={o.paymentStatus === 'pending'}>
						<div class="hst-order-card-head">
							<div class="hst-order-card-icon" data-payment={o.paymentStatus}>
								<MIcon size={16} />
							</div>
							<div class="hst-order-card-text">
								<div class="hst-order-card-name">{o.contactName}</div>
								<div class="hst-order-card-meta">
									<span>{fmtRelative(o.createdAt)}</span>
									<span>·</span>
									<span>{o.productName ?? 'Produs necunoscut'}</span>
								</div>
							</div>
							<span class="hst-status-pill" data-status={o.paymentStatus}>
								<span class="dot"></span>
								{paymentLabel(o.paymentStatus)}
							</span>
						</div>

						<div class="hst-order-amount">
							<strong>
								{o.paidAmountCents != null
									? fmtMoney(o.paidAmountCents, o.productCurrency)
									: o.productPrice != null
										? `${o.productPrice} ${o.productCurrency ?? 'RON'}`
										: '—'}
							</strong>
							<span>{methodLabel(o.paymentMethod)}</span>
						</div>

						<div class="hst-pipeline">
							<div class="hst-pipeline-step" class:done={o.paymentStatus === 'paid'} class:failed={o.paymentStatus === 'failed'}>
								<span class="hst-pipeline-dot"></span>
								<span>Plată</span>
							</div>
							<div class="hst-pipeline-arrow"></div>
							<div class="hst-pipeline-step" class:done={!!o.hostingAccountId} class:waiting={o.paymentStatus === 'paid' && !o.hostingAccountId}>
								<span class="hst-pipeline-dot"></span>
								<span>Cont DA</span>
							</div>
							<div class="hst-pipeline-arrow"></div>
							<div class="hst-pipeline-step" class:done={o.status === 'converted'}>
								<span class="hst-pipeline-dot"></span>
								<span>Convertit</span>
							</div>
						</div>

						<div class="hst-order-foot">
							<div class="hst-order-foot-info">
								{#if o.daDomain}
									<code>{o.daDomain}</code>
								{:else}
									<span class="muted">Fără cont DA încă</span>
								{/if}
							</div>
							<div class="hst-order-actions">
								{#if o.paymentStatus !== 'paid'}
									<button
										class="btn-secondary"
										disabled={busyId === o.id}
										onclick={() => {
											openOrder = o;
											openAcceptDialog(o);
										}}
									>
										<CheckCircle2Icon size={13} /> Acceptă plată
									</button>
								{:else if !o.hostingAccountId}
									<button
										class="btn-secondary"
										disabled={busyId === o.id}
										onclick={() => handleRetry(o)}
									>
										<PlayIcon size={13} /> Provisioning DA
									</button>
								{/if}
								<button class="btn-ghost" onclick={() => (openOrder = o)}>
									Detalii
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="hst-table-wrap">
				<table class="hst-table">
					<thead>
						<tr>
							<th>Data</th>
							<th>Client</th>
							<th>Pachet</th>
							<th class="num">Sumă</th>
							<th>Metodă</th>
							<th>Status plată</th>
							<th>Cont DA</th>
							<th>Funnel</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as o (o.id)}
							<tr onclick={() => (openOrder = o)}>
								<td>
									<div class="hst-host-cell">{fmtRelative(o.createdAt)}</div>
									<div class="hst-host-sub">{fmtDate(o.createdAt)}</div>
								</td>
								<td>
									<div class="hst-host-cell">{o.contactName}</div>
									<div class="hst-host-sub">{o.contactEmail}</div>
								</td>
								<td>{o.productName ?? '—'}</td>
								<td class="num">
									{o.paidAmountCents != null
										? fmtMoney(o.paidAmountCents, o.productCurrency)
										: o.productPrice != null
											? `${o.productPrice} ${o.productCurrency ?? 'RON'}`
											: '—'}
								</td>
								<td>{methodLabel(o.paymentMethod)}</td>
								<td>
									<span class="hst-status-pill" data-status={o.paymentStatus}>
										<span class="dot"></span>{paymentLabel(o.paymentStatus)}
									</span>
								</td>
								<td>
									{#if o.daUsername}
										<code class="hst-mono">{o.daUsername}</code>
									{:else}
										<span class="muted">—</span>
									{/if}
								</td>
								<td>{statusLabel(o.status)}</td>
								<td>
									<button class="hst-icon-btn" onclick={(e) => { e.stopPropagation(); openOrder = o; }} title="Detalii">
										<ExternalLinkIcon size={12} />
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:catch err}
		<div class="hst-empty">
			<AlertTriangleIcon size={36} />
			<p>Eroare la încărcare: {err instanceof Error ? err.message : String(err)}</p>
		</div>
	{/await}
</div>

{#if openOrder}
	{@const o = openOrder}
	<button
		class="hst-drawer-back"
		aria-label="Închide"
		onclick={() => {
			openOrder = null;
			acceptOpen = false;
		}}
	></button>
	<div
		class="hst-drawer"
		role="dialog"
		aria-modal="true"
		aria-labelledby="order-drawer-title"
		use:focusTrap={{ initialFocus: '.hst-drawer-close' }}
	>
		<header class="hst-drawer-head">
			<div class="hst-drawer-title" id="order-drawer-title">{o.contactName}</div>
			<span class="hst-status-pill" data-status={o.paymentStatus}>
				<span class="dot"></span>{paymentLabel(o.paymentStatus)}
			</span>
			<button
				class="hst-drawer-close"
				aria-label="Închide"
				onclick={() => {
					openOrder = null;
					acceptOpen = false;
				}}
			>
				<XIcon size={16} />
			</button>
		</header>

		<div class="hst-drawer-body">
			<!-- Contact + firmă -->
			<section>
				<h3>Date contact</h3>
				<dl class="hst-kv">
					<dt><MailIcon size={12} /> Email</dt>
					<dd><a href="mailto:{o.contactEmail}">{o.contactEmail}</a></dd>
					{#if o.contactPhone}
						<dt><PhoneIcon size={12} /> Telefon</dt>
						<dd><a href="tel:{o.contactPhone}">{o.contactPhone}</a></dd>
					{/if}
					{#if o.companyName}
						<dt><Building2Icon size={12} /> Firmă</dt>
						<dd>{o.companyName}{o.vatNumber ? ` (${o.vatNumber})` : ''}</dd>
					{/if}
					<dt>Creată</dt>
					<dd>{fmtDate(o.createdAt)}</dd>
					{#if o.ipAddress}
						<dt>IP</dt>
						<dd><code>{o.ipAddress}</code></dd>
					{/if}
				</dl>
			</section>

			<!-- Plată -->
			<section>
				<h3>Plată</h3>
				<dl class="hst-kv">
					<dt>Pachet</dt>
					<dd>{o.productName ?? '—'}</dd>
					<dt>Metodă</dt>
					<dd>{methodLabel(o.paymentMethod)}</dd>
					<dt>Status</dt>
					<dd>
						<span class="hst-status-pill" data-status={o.paymentStatus}>
							<span class="dot"></span>{paymentLabel(o.paymentStatus)}
						</span>
					</dd>
					<dt>Sumă</dt>
					<dd>
						{o.paidAmountCents != null
							? fmtMoney(o.paidAmountCents, o.productCurrency)
							: '—'}
					</dd>
					{#if o.paidAt}
						<dt>Plătită</dt>
						<dd>{fmtDate(o.paidAt)}</dd>
					{/if}
					{#if o.paymentReference}
						<dt>Referință</dt>
						<dd><code class="hst-mono">{o.paymentReference}</code></dd>
					{/if}
					{#if o.stripeCheckoutSessionId}
						<dt>Stripe Session</dt>
						<dd><code class="hst-mono">{o.stripeCheckoutSessionId}</code></dd>
					{/if}
					{#if o.acceptedAt}
						<dt>Acceptat manual</dt>
						<dd>{fmtDate(o.acceptedAt)}</dd>
					{/if}
				</dl>

				{#if o.paymentStatus !== 'paid' && !acceptOpen}
					<button class="btn-primary" onclick={() => openAcceptDialog(o)}>
						<CheckCircle2Icon size={13} /> Acceptă plată manual
					</button>
				{/if}

				{#if acceptOpen}
					<div class="hst-accept-form">
						<h4>Confirmă încasarea</h4>
						<label>
							<span>Metodă</span>
							<select bind:value={acceptMethod}>
								<option value="op">Ordin de plată</option>
								<option value="card">Card (offline / POS)</option>
								<option value="paypal">PayPal</option>
								<option value="revolut">Revolut</option>
								<option value="other">Altă metodă</option>
							</select>
						</label>
						<label>
							<span>Sumă ({o.productCurrency ?? 'RON'})</span>
							<input
								type="text"
								inputmode="decimal"
								bind:value={acceptAmount}
								placeholder="123.45"
							/>
						</label>
						<label>
							<span>Referință (opțional)</span>
							<input
								type="text"
								bind:value={acceptRef}
								placeholder="OP nr. 12345 / extras 21.05.2026"
								maxlength="200"
							/>
						</label>
						<label>
							<span>Notă (opțional)</span>
							<textarea
								bind:value={acceptNote}
								rows="2"
								maxlength="500"
								placeholder="Detalii pentru audit intern"
							></textarea>
						</label>
						<label class="hst-accept-check">
							<input type="checkbox" bind:checked={acceptProvision} />
							<span>Declanșează provisioning DirectAdmin</span>
						</label>
						<div class="hst-accept-actions">
							<button class="btn-ghost" onclick={() => (acceptOpen = false)} disabled={accepting}>
								Anulează
							</button>
							<button class="btn-primary" onclick={() => submitAccept(o.id)} disabled={accepting}>
								{accepting ? 'Se acceptă…' : 'Confirmă'}
							</button>
						</div>
					</div>
				{/if}
			</section>

			<!-- Provisioning -->
			<section>
				<h3>Provisioning DirectAdmin</h3>
				{#if o.hostingAccountId && o.daUsername}
					<dl class="hst-kv">
						<dt>Status</dt>
						<dd>
							<span class="hst-status-pill" data-status="paid">
								<span class="dot"></span>{o.daAccountStatus === 'suspended' ? 'Suspendat' : 'Activ'}
							</span>
						</dd>
						<dt>Username</dt>
						<dd><code class="hst-mono">{o.daUsername}</code></dd>
						<dt>Domeniu</dt>
						<dd><code class="hst-mono">{o.daDomain}</code></dd>
					</dl>
					<a href="../accounts/{o.hostingAccountId}" class="btn-secondary">
						<ExternalLinkIcon size={13} /> Vezi contul în CRM
					</a>
				{:else if o.paymentStatus === 'paid'}
					<p class="hst-warning">
						<AlertTriangleIcon size={13} />
						Plata e confirmată, dar contul DirectAdmin n-a fost creat. Re-rulează provisioning-ul.
					</p>
					<button class="btn-primary" disabled={busyId === o.id} onclick={() => handleRetry(o)}>
						<PlayIcon size={13} /> Rulează provisioning
					</button>
				{:else}
					<p class="muted">Provisioning-ul rulează automat după ce plata este confirmată.</p>
				{/if}
			</section>

			<!-- Notes & funnel -->
			<section>
				<h3>Note &amp; funnel</h3>
				{#if o.message}
					<pre class="hst-message">{o.message}</pre>
				{:else}
					<p class="muted">Fără note.</p>
				{/if}
				<div class="hst-funnel-actions">
					<span>Status funnel:</span>
					{#each ['new', 'contacted', 'converted', 'discarded'] as s (s)}
						{#if s !== o.status}
							<button
								class="btn-secondary small"
								disabled={busyId === o.id}
								onclick={() => setStatus(o.id, s as 'new' | 'contacted' | 'converted' | 'discarded')}
							>
								→ {statusLabel(s)}
							</button>
						{/if}
					{/each}
				</div>
				<button class="btn-ghost danger" disabled={busyId === o.id} onclick={() => handleDelete(o)}>
					<Trash2Icon size={13} /> Șterge comanda
				</button>
			</section>
		</div>
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
</style>
