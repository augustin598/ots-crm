<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		getHostingProducts,
		getHostingProductStats,
		createHostingProduct,
		updateHostingProduct,
		deleteHostingProduct
	} from '$lib/remotes/hosting-products.remote';
	import { getDAServers, getDAPackagesForServer } from '$lib/remotes/da-servers.remote';
	import { focusTrap } from '$lib/actions/focus-trap';
	import PackageIcon from '@lucide/svelte/icons/package';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import StarIcon from '@lucide/svelte/icons/star';
	import PowerIcon from '@lucide/svelte/icons/power';
	import Columns3Icon from '@lucide/svelte/icons/columns-3';
	import ListIcon from '@lucide/svelte/icons/list';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import MailIcon from '@lucide/svelte/icons/mail';
	import LockIcon from '@lucide/svelte/icons/lock';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MoreHorizontalIcon from '@lucide/svelte/icons/ellipsis';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';

	type BillingCycle =
		| 'monthly'
		| 'quarterly'
		| 'biannually'
		| 'annually'
		| 'triennially'
		| 'one_time';

	type ProductRow = {
		id: string;
		name: string;
		description: string | null;
		features: string[] | null;
		highlightBadge: string | null;
		sortOrder: number;
		price: number;
		currency: string;
		billingCycle: string;
		setupFee: number;
		isActive: boolean;
		daServerId: string | null;
		daPackageId: string | null;
		serverName: string | null;
		packageName: string | null;
		pkgBandwidth: number | null;
		pkgQuota: number | null;
		pkgMaxEmailAccounts: number | null;
		pkgMaxDatabases: number | null;
		pkgMaxDomains: number | null;
		pkgMaxSubdomains: number | null;
		pkgIsActive: boolean | null;
		createdAt: Date;
	};

	type EditMode = 'new' | 'edit' | 'duplicate';

	type FormState = {
		id: string | null;
		name: string;
		description: string;
		featuresText: string;
		highlightBadge: string;
		sortOrder: number;
		daServerId: string;
		daPackageId: string;
		price: number;
		currency: string;
		billingCycle: BillingCycle;
		setupFee: number;
		isActive: boolean;
		color: string;
	};

	const PALETTE = [
		'#64748b',
		'#1877F2',
		'#0d5cc7',
		'#7c3aed',
		'#ec4899',
		'#10b981',
		'#f59e0b',
		'#ef4444'
	];

	let productsPromise = $state(getHostingProducts());
	let statsPromise = $state(getHostingProductStats());
	const serversQuery = $derived(getDAServers());

	function refresh() {
		productsPromise = getHostingProducts();
		statsPromise = getHostingProductStats();
	}

	let view = $state<'cards' | 'table'>('cards');

	let editing = $state<{ mode: EditMode; form: FormState } | null>(null);
	let deleting = $state<ProductRow | null>(null);
	let openMenuFor = $state<string | null>(null);
	let submitting = $state(false);

	// Derive the packages query from the currently-selected DA server in the
	// editing form. Using $derived (not $effect) keeps the reactivity declarative
	// and avoids the malpractice of state-assignment-inside-effect.
	const packagesQuery = $derived(
		editing && editing.form.daServerId
			? getDAPackagesForServer(editing.form.daServerId)
			: null
	);
	const packages = $derived(packagesQuery?.current ?? []);

	const FEATURES_PLACEHOLDER =
		'Backup zilnic\n' +
		'WordPress Toolkit\n' +
		'Transfer hosting gratuit\n' +
		'Litespeed + LS Cache\n' +
		'Securitate prin Imunify360\n' +
		'Certificat SSL Gratuit\n' +
		'Suport în română';

	function emptyForm(): FormState {
		return {
			id: null,
			name: '',
			description: '',
			featuresText: '',
			highlightBadge: '',
			sortOrder: 0,
			daServerId: '',
			daPackageId: '',
			price: 0,
			currency: 'RON',
			billingCycle: 'monthly',
			setupFee: 0,
			isActive: true,
			color: PALETTE[1]
		};
	}

	function colorFor(p: ProductRow): string {
		return PALETTE[p.sortOrder % PALETTE.length] || PALETTE[1];
	}

	function isPopular(p: ProductRow): boolean {
		return !!(p.highlightBadge && p.highlightBadge.trim().length > 0);
	}

	function fmtRON(cents: number, currency: string): string {
		return (
			(cents / 100).toLocaleString('ro-RO', {
				minimumFractionDigits: 0,
				maximumFractionDigits: 2
			}) +
			' ' +
			currency
		);
	}

	function fmtPriceVal(cents: number): string {
		return (cents / 100).toLocaleString('ro-RO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 2
		});
	}

	function fmtLimit(value: number | null | undefined): string {
		if (value === null || value === undefined) return 'Nelimitat';
		return value.toLocaleString('ro-RO');
	}

	function mbToGb(mb: number | null | undefined): string {
		if (mb === null || mb === undefined) return 'Nelimitat';
		if (mb < 1024) return `${mb} MB`;
		return `${(mb / 1024).toLocaleString('ro-RO', { maximumFractionDigits: 1 })} GB`;
	}

	function cycleLabel(c: string): string {
		switch (c) {
			case 'monthly':
				return 'lună';
			case 'quarterly':
				return 'trimestru';
			case 'semiannually':
			case 'biannually':
				return 'semestru';
			case 'annually':
				return 'an';
			case 'biennially':
				return '2 ani';
			case 'triennially':
				return '3 ani';
			case 'one_time':
				return 'unic';
			default:
				return c;
		}
	}

	function cycleFullLabel(c: string): string {
		switch (c) {
			case 'monthly':
				return 'Lunar';
			case 'quarterly':
				return 'Trimestrial';
			case 'semiannually':
			case 'biannually':
				return 'Semestrial';
			case 'annually':
				return 'Anual';
			case 'biennially':
				return 'Bi-anual';
			case 'triennially':
				return '3 ani';
			case 'one_time':
				return 'O singură dată';
			default:
				return c;
		}
	}

	function backupHintFor(p: ProductRow): string {
		const feats = p.features ?? [];
		const hit = feats.find((f) => /backup/i.test(f));
		if (hit) return hit;
		return 'zilnic';
	}

	function statsFor(
		statsMap: Record<string, { sold: number; mrrCents: number }> | null,
		productId: string
	): { sold: number; mrrCents: number } {
		return statsMap?.[productId] ?? { sold: 0, mrrCents: 0 };
	}

	function parseFeatures(text: string): string[] {
		return text
			.split('\n')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	}

	function openCreate() {
		editing = { mode: 'new', form: emptyForm() };
	}

	function openEdit(p: ProductRow) {
		editing = {
			mode: 'edit',
			form: {
				id: p.id,
				name: p.name,
				description: p.description ?? '',
				featuresText: (p.features ?? []).join('\n'),
				highlightBadge: p.highlightBadge ?? '',
				sortOrder: p.sortOrder,
				daServerId: p.daServerId ?? '',
				daPackageId: p.daPackageId ?? '',
				price: p.price / 100,
				currency: p.currency,
				billingCycle: p.billingCycle as BillingCycle,
				setupFee: p.setupFee / 100,
				isActive: p.isActive,
				color: colorFor(p)
			}
		};
	}

	function openDuplicate(p: ProductRow) {
		editing = {
			mode: 'duplicate',
			form: {
				id: null,
				name: `${p.name} (copie)`,
				description: p.description ?? '',
				featuresText: (p.features ?? []).join('\n'),
				highlightBadge: '',
				sortOrder: p.sortOrder + 1,
				daServerId: p.daServerId ?? '',
				daPackageId: p.daPackageId ?? '',
				price: p.price / 100,
				currency: p.currency,
				billingCycle: p.billingCycle as BillingCycle,
				setupFee: p.setupFee / 100,
				isActive: true,
				color: colorFor(p)
			}
		};
	}

	async function submitForm() {
		if (!editing) return;
		const f = editing.form;
		if (!f.name.trim()) {
			toast.error('Numele este obligatoriu');
			return;
		}
		if (f.price < 0) {
			toast.error('Prețul nu poate fi negativ');
			return;
		}
		submitting = true;
		try {
			// Use `null` (not undefined) for cleared fields so Drizzle writes NULL
			// instead of dropping the column from the UPDATE — otherwise users can't
			// un-link a server or clear a badge via the "fără" affordance.
			const payload = {
				name: f.name.trim(),
				description: f.description.trim() ? f.description.trim() : null,
				features: parseFeatures(f.featuresText),
				highlightBadge: f.highlightBadge.trim() ? f.highlightBadge.trim() : null,
				sortOrder: f.sortOrder,
				daServerId: f.daServerId ? f.daServerId : null,
				daPackageId: f.daPackageId ? f.daPackageId : null,
				price: Math.round(f.price * 100),
				currency: f.currency.trim().toUpperCase() || 'RON',
				billingCycle: f.billingCycle,
				setupFee: Math.round(f.setupFee * 100),
				isActive: f.isActive
			};
			if (editing.mode === 'edit' && f.id) {
				await updateHostingProduct({ id: f.id, data: payload });
				toast.success('Modificări salvate', { description: payload.name });
			} else {
				await createHostingProduct(payload);
				toast.success(
					editing.mode === 'duplicate' ? 'Pachet duplicat' : 'Pachet creat',
					{ description: `${payload.name} adăugat în catalog` }
				);
			}
			editing = null;
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			submitting = false;
		}
	}

	async function togglePopular(p: ProductRow, allProducts: ProductRow[]) {
		const becoming = !isPopular(p);
		try {
			// Only one TOP at a time — clear others first.
			// Sequential issue acceptable: typical catalog has <10 products and
			// concurrent admin clicks are rare. If contention becomes an issue,
			// move to a single-statement UPDATE with WHERE id != target.
			if (becoming) {
				for (const other of allProducts) {
					if (other.id !== p.id && isPopular(other)) {
						await updateHostingProduct({ id: other.id, data: { highlightBadge: null } });
					}
				}
			}
			await updateHostingProduct({
				id: p.id,
				data: { highlightBadge: becoming ? 'Cel mai vândut' : null }
			});
			toast.success(becoming ? 'Marcat ca TOP vândut' : 'Badge TOP scos', { description: p.name });
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function toggleActive(p: ProductRow) {
		try {
			await updateHostingProduct({ id: p.id, data: { isActive: !p.isActive } });
			toast.success(p.isActive ? 'Pachet dezactivat' : 'Pachet activat', {
				description: p.name
			});
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function confirmDelete(kind: 'delete' | 'deactivate') {
		if (!deleting) return;
		const p = deleting;
		try {
			if (kind === 'delete') {
				await deleteHostingProduct(p.id);
				toast.success('Pachet șters', { description: p.name });
			} else {
				await updateHostingProduct({ id: p.id, data: { isActive: false } });
				toast.success('Pachet dezactivat', { description: p.name });
			}
			deleting = null;
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	function previewPublic() {
		window.open('/pachete-hosting', '_blank', 'noopener');
	}

	// KPI helpers
	function topSellingName(
		products: ProductRow[],
		statsMap: Record<string, { sold: number; mrrCents: number }>
	): { name: string; sold: number; pct: number } | null {
		if (!products.length) return null;
		let bestId: string | null = null;
		let bestSold = 0;
		let total = 0;
		for (const p of products) {
			const sold = statsMap[p.id]?.sold ?? 0;
			total += sold;
			if (sold > bestSold) {
				bestSold = sold;
				bestId = p.id;
			}
		}
		if (!bestId || bestSold === 0) return null;
		const best = products.find((p) => p.id === bestId);
		if (!best) return null;
		const pct = total > 0 ? Math.round((bestSold / total) * 100) : 0;
		return { name: best.name, sold: bestSold, pct };
	}
</script>

<div class="hst-page">
	<div class="hst-hero">
		<div>
			<h1>Produse hosting</h1>
			<p>
				{#await productsPromise}
					Se încarcă pachetele…
				{:then list}
					{list.filter((p) => p.isActive).length} active · {list.length} totale · sincronizate cu pagina
					publică
					<a class="hst-link" href="/pachete-hosting" target="_blank" rel="noopener"
						>/pachete-hosting</a
					>
				{:catch}
					Eroare la încărcare
				{/await}
			</p>
		</div>
		<div class="hst-hero-actions">
			<button type="button" class="btn-secondary" onclick={previewPublic}>
				<GlobeIcon size={13} /> Vezi pagina publică
			</button>
			<button type="button" class="btn-primary" onclick={openCreate}>
				<PlusIcon size={14} /> Produs nou
			</button>
		</div>
	</div>

	{#await Promise.all([productsPromise, statsPromise])}
		<div class="hst-loading">Se încarcă produsele…</div>
	{:then [products, statsMap]}
		{@const sortedProducts = [...products].sort((a, b) => {
			if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
			return a.price - b.price;
		})}
		{@const activeProducts = sortedProducts.filter((p) => p.isActive)}
		{@const inactiveCount = sortedProducts.length - activeProducts.length}
		{@const totalSold = Object.values(statsMap).reduce((a, s) => a + s.sold, 0)}
		{@const totalMrr = Object.values(statsMap).reduce((a, s) => a + s.mrrCents, 0)}
		{@const arpu = totalSold > 0 ? totalMrr / totalSold : 0}
		{@const top = topSellingName(sortedProducts, statsMap)}

		<div class="hst-kpis">
			<div class="dash-kpi primary">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(24,119,242,.12); color:#1877F2;">
						<PackageIcon size={13} />
					</div>
					<span class="dash-kpi-label">Produse</span>
				</div>
				<div class="dash-kpi-value">{activeProducts.length}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">
						active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ''}
					</span>
				</div>
			</div>

			<div class="dash-kpi success">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(16,185,129,.12); color:#10b981;">
						<DatabaseIcon size={13} />
					</div>
					<span class="dash-kpi-label">Total vândute</span>
				</div>
				<div class="dash-kpi-value">{totalSold}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">conturi active pe pachete</span>
				</div>
			</div>

			<div class="dash-kpi success">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(16,185,129,.12); color:#10b981;">
						<DollarSignIcon size={13} />
					</div>
					<span class="dash-kpi-label">MRR pachete</span>
				</div>
				<div class="dash-kpi-value">{fmtRON(totalMrr, 'RON')}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">venit recurent / lună</span>
				</div>
			</div>

			<div class="dash-kpi info">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(99,102,241,.12); color:#6366f1;">
						<TrendingUpIcon size={13} />
					</div>
					<span class="dash-kpi-label">ARPU mediu</span>
				</div>
				<div class="dash-kpi-value">{fmtRON(Math.round(arpu), 'RON')}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">venit per cont / lună</span>
				</div>
			</div>

			<div class="dash-kpi info">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(99,102,241,.12); color:#6366f1;">
						<StarIcon size={13} />
					</div>
					<span class="dash-kpi-label">Cel mai vândut</span>
				</div>
				<div class="dash-kpi-value">
					{top ? top.name : '—'}
				</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">
						{top ? `${top.sold} conturi · ${top.pct}%` : 'fără date'}
					</span>
				</div>
			</div>

			<div class="dash-kpi warn">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(245,158,11,.14); color:#f59e0b;">
						<PowerIcon size={13} />
					</div>
					<span class="dash-kpi-label">Inactive</span>
				</div>
				<div class="dash-kpi-value">{inactiveCount}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">ascunse de pagina publică</span>
				</div>
			</div>
		</div>

		<div class="hst-toolbar">
			<div class="hst-toolbar-spacer"></div>
			<div class="hst-view-toggle" role="group" aria-label="Mod afișare">
				<button
					type="button"
					class={view === 'cards' ? 'active' : ''}
					aria-pressed={view === 'cards'}
					onclick={() => (view = 'cards')}
				>
					<Columns3Icon size={11} /> Carduri
				</button>
				<button
					type="button"
					class={view === 'table' ? 'active' : ''}
					aria-pressed={view === 'table'}
					onclick={() => (view = 'table')}
				>
					<ListIcon size={11} /> Tabel comparativ
				</button>
			</div>
		</div>

		{#if sortedProducts.length === 0}
			<div class="hst-empty">
				<PackageIcon size={36} />
				<div class="hst-empty-title">Niciun pachet definit</div>
				<div class="hst-empty-sub">
					Adaugă primul pachet pentru a-l face vizibil pe pagina publică /pachete-hosting.
				</div>
				<button type="button" class="btn-primary" onclick={openCreate}>
					<PlusIcon size={14} /> Produs nou
				</button>
			</div>
		{:else if view === 'cards'}
			<div class="hst-products-grid">
				{#each sortedProducts as p (p.id)}
					{@const stat = statsFor(statsMap, p.id)}
					{@const popular = isPopular(p)}
					{@const color = colorFor(p)}
					<div
						class="hst-product"
						class:popular
						class:inactive={!p.isActive}
					>
						{#if popular}
							<span class="hst-product-badge">{p.highlightBadge}</span>
						{/if}
						{#if !p.isActive}
							<span class="hst-product-badge muted">Inactiv</span>
						{/if}

						<div>
							<div class="hst-product-name">
								<span class="hst-product-color" style:background={color}></span>
								{p.name}
							</div>
							{#if p.description}
								<div class="hst-product-tag">{p.description}</div>
							{/if}
						</div>

						<div class="hst-product-price-block">
							<div class="hst-product-price">
								<span class="hst-product-price-val">{fmtPriceVal(p.price)}</span>
								<span class="hst-product-price-cur">{p.currency}</span>
								<span class="hst-product-price-per">/ {cycleLabel(p.billingCycle)}</span>
							</div>
							{#if p.setupFee > 0}
								<div class="hst-product-setup">
									+ setup unic {fmtRON(p.setupFee, p.currency)}
								</div>
							{/if}
						</div>

						<div class="hst-product-specs">
							<div class="hst-spec">
								<HardDriveIcon size={13} />
								<span><strong>{mbToGb(p.pkgQuota)}</strong> spațiu SSD</span>
							</div>
							<div class="hst-spec">
								<ActivityIcon size={13} />
								<span><strong>{mbToGb(p.pkgBandwidth)}</strong> trafic / lună</span>
							</div>
							<div class="hst-spec">
								<GlobeIcon size={13} />
								<span><strong>{fmtLimit(p.pkgMaxDomains)}</strong> domenii găzduite</span>
							</div>
							<div class="hst-spec">
								<DatabaseIcon size={13} />
								<span><strong>{fmtLimit(p.pkgMaxDatabases)}</strong> baze de date</span>
							</div>
							<div class="hst-spec">
								<MailIcon size={13} />
								<span><strong>{fmtLimit(p.pkgMaxEmailAccounts)}</strong> conturi email</span>
							</div>
							<div class="hst-spec">
								<LockIcon size={13} />
								<span>SSL Let's Encrypt inclus</span>
							</div>
							<div class="hst-spec">
								<DatabaseIcon size={13} />
								<span>Backup {backupHintFor(p)}</span>
							</div>
						</div>

						{#if p.features && p.features.length > 0}
							<div class="hst-product-features">
								{#each p.features.slice(0, 5) as feat (feat)}
									<div class="hst-feat">
										<CheckIcon size={11} />
										<span>{feat}</span>
									</div>
								{/each}
								{#if p.features.length > 5}
									<div class="hst-feat-more">+ {p.features.length - 5} alte beneficii</div>
								{/if}
							</div>
						{/if}

						{#if p.serverName || p.packageName}
							<div class="hst-product-server">
								<span class="hst-product-server-l">Sursă limite:</span>
								<span class="hst-product-server-v">
									{p.serverName ?? '—'}
									{#if p.packageName}
										· <strong>{p.packageName}</strong>
									{/if}
									{#if p.packageName && p.pkgIsActive === false}
										<span class="hst-pkg-inactive">(pachet DA inactiv)</span>
									{/if}
								</span>
							</div>
						{/if}

						<div class="hst-product-foot">
							<div class="hst-product-stats">
								<div class="hst-product-stat-l">Conturi · MRR</div>
								<div class="hst-product-stat-v">
									{stat.sold} · {fmtRON(stat.mrrCents, p.currency)}
								</div>
							</div>
							<button
								type="button"
								class="hst-icon-btn"
								title="Editează"
								aria-label="Editează {p.name}"
								onclick={() => openEdit(p)}
							>
								<PencilIcon size={13} />
							</button>
							<button
								type="button"
								class="hst-icon-btn"
								title="Duplică"
								aria-label="Duplică {p.name}"
								onclick={() => openDuplicate(p)}
							>
								<CopyIcon size={13} />
							</button>
							<div class="hst-menu-anchor">
								<button
									type="button"
									class="hst-icon-btn"
									title="Mai multe"
									aria-label="Mai multe acțiuni pentru {p.name}"
									aria-haspopup="menu"
									aria-expanded={openMenuFor === p.id}
									onclick={(e) => {
										e.stopPropagation();
										openMenuFor = openMenuFor === p.id ? null : p.id;
									}}
								>
									<MoreHorizontalIcon size={13} />
								</button>
								{#if openMenuFor === p.id}
									<button
										type="button"
										class="hst-menu-back"
										aria-label="Închide meniul"
										onclick={() => (openMenuFor = null)}
									></button>
									<div class="hst-row-menu" role="menu">
										<button
											type="button"
											role="menuitem"
											onclick={() => {
												openMenuFor = null;
												openEdit(p);
											}}
										>
											<PencilIcon size={12} /> Editează
										</button>
										<button
											type="button"
											role="menuitem"
											onclick={() => {
												openMenuFor = null;
												openDuplicate(p);
											}}
										>
											<CopyIcon size={12} /> Duplică
										</button>
										<button
											type="button"
											role="menuitem"
											onclick={() => {
												openMenuFor = null;
												togglePopular(p, sortedProducts);
											}}
										>
											<StarIcon size={12} />
											{popular ? 'Scoate badge TOP' : 'Marchează ca TOP'}
										</button>
										<button
											type="button"
											role="menuitem"
											onclick={() => {
												openMenuFor = null;
												toggleActive(p);
											}}
										>
											<PowerIcon size={12} />
											{p.isActive ? 'Dezactivează' : 'Activează'}
										</button>
										<button
											type="button"
											role="menuitem"
											onclick={() => {
												openMenuFor = null;
												previewPublic();
											}}
										>
											<EyeIcon size={12} /> Vezi pagina publică
										</button>
										<hr />
										<button
											type="button"
											role="menuitem"
											class="danger"
											onclick={() => {
												openMenuFor = null;
												deleting = p;
											}}
										>
											<Trash2Icon size={12} /> Șterge pachet
										</button>
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="hst-table-wrap">
				<table class="hst-table hst-products-table">
					<thead>
						<tr>
							<th class="hst-table-feat-col">Caracteristică</th>
							{#each sortedProducts as p (p.id)}
								{@const popular = isPopular(p)}
								{@const color = colorFor(p)}
								<th class="hst-table-prod-col">
									<div class="hst-table-prod-head">
										<span class="hst-table-prod-color" style:background={color}></span>
										<span class="hst-table-prod-name">{p.name}</span>
										{#if popular}
											<span class="hst-table-pill hst-pill-top">TOP</span>
										{/if}
										{#if !p.isActive}
											<span class="hst-table-pill hst-pill-off">OFF</span>
										{/if}
									</div>
									<div class="hst-table-prod-actions">
										<button
											type="button"
											class="hst-icon-btn sm"
											title="Editează"
											aria-label="Editează {p.name}"
											onclick={() => openEdit(p)}
										>
											<PencilIcon size={10} />
										</button>
										<button
											type="button"
											class="hst-icon-btn sm"
											title="Duplică"
											aria-label="Duplică {p.name}"
											onclick={() => openDuplicate(p)}
										>
											<CopyIcon size={10} />
										</button>
										<button
											type="button"
											class="hst-icon-btn sm"
											title="Șterge"
											aria-label="Șterge {p.name}"
											onclick={() => (deleting = p)}
										>
											<Trash2Icon size={10} />
										</button>
									</div>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><strong>Preț</strong></td>
							{#each sortedProducts as p (p.id)}
								<td class="hst-tcell-strong">
									{fmtRON(p.price, p.currency)} / {cycleLabel(p.billingCycle)}
								</td>
							{/each}
						</tr>
						<tr>
							<td>Ciclu facturare</td>
							{#each sortedProducts as p (p.id)}
								<td>{cycleFullLabel(p.billingCycle)}</td>
							{/each}
						</tr>
						<tr>
							<td>Taxă setup</td>
							{#each sortedProducts as p (p.id)}
								<td>{p.setupFee > 0 ? fmtRON(p.setupFee, p.currency) : '—'}</td>
							{/each}
						</tr>
						<tr>
							<td>Spațiu SSD</td>
							{#each sortedProducts as p (p.id)}
								<td>{mbToGb(p.pkgQuota)}</td>
							{/each}
						</tr>
						<tr>
							<td>Trafic lunar</td>
							{#each sortedProducts as p (p.id)}
								<td>{mbToGb(p.pkgBandwidth)}</td>
							{/each}
						</tr>
						<tr>
							<td>Domenii găzduite</td>
							{#each sortedProducts as p (p.id)}
								<td>{fmtLimit(p.pkgMaxDomains)}</td>
							{/each}
						</tr>
						<tr>
							<td>Baze de date MySQL</td>
							{#each sortedProducts as p (p.id)}
								<td>{fmtLimit(p.pkgMaxDatabases)}</td>
							{/each}
						</tr>
						<tr>
							<td>Conturi email</td>
							{#each sortedProducts as p (p.id)}
								<td>{fmtLimit(p.pkgMaxEmailAccounts)}</td>
							{/each}
						</tr>
						<tr>
							<td>SSL Let's Encrypt</td>
							{#each sortedProducts as p (p.id)}
								<td class="hst-feat-check"><CheckIcon size={14} /></td>
							{/each}
						</tr>
						<tr>
							<td>Backup</td>
							{#each sortedProducts as p (p.id)}
								<td class="hst-tcell-small">{backupHintFor(p)}</td>
							{/each}
						</tr>
						<tr>
							<td>Sursă limite DA</td>
							{#each sortedProducts as p (p.id)}
								<td class="hst-tcell-small">
									{p.serverName ?? '—'}{#if p.packageName} · {p.packageName}{/if}
								</td>
							{/each}
						</tr>
						<tr class="hst-tr-emph">
							<td><strong>Conturi vândute</strong></td>
							{#each sortedProducts as p (p.id)}
								{@const stat = statsFor(statsMap, p.id)}
								<td class="hst-tcell-strong">{stat.sold}</td>
							{/each}
						</tr>
						<tr class="hst-tr-emph">
							<td><strong>MRR generat</strong></td>
							{#each sortedProducts as p (p.id)}
								{@const stat = statsFor(statsMap, p.id)}
								<td class="hst-tcell-strong hst-tcell-mrr">{fmtRON(stat.mrrCents, p.currency)}</td>
							{/each}
						</tr>
					</tbody>
				</table>
			</div>
		{/if}

		<!-- Product modal -->
		{#if editing}
			{@const f = editing.form}
			{@const yearEquivalent = f.price * 12}
			{@const popularSelected = !!f.highlightBadge.trim()}
			<!--
				No backdrop-dismiss on the edit modal: users routinely spend a few
				minutes in the form and an accidental backdrop click would discard
				everything. Close via Escape (focusTrap), the X button, or "Anulează".
			-->
			<div class="hst-modal-back" role="presentation"></div>
			<div
				class="hst-modal lg"
				role="dialog"
				aria-modal="true"
				aria-labelledby="product-modal-title"
				use:focusTrap={{ active: true, onEscape: () => (editing = null) }}
			>
				<div class="hst-modal-head">
					<div class="hst-modal-icon" style:background="linear-gradient(135deg, {f.color}, {f.color}dd)">
						<PackageIcon size={18} />
					</div>
					<div class="hst-modal-head-text">
						<div class="hst-modal-title" id="product-modal-title">
							{editing.mode === 'new'
								? 'Pachet nou'
								: editing.mode === 'duplicate'
								? 'Duplică pachet'
								: 'Editează pachet'}
						</div>
						<div class="hst-modal-sub">
							{editing.mode === 'new'
								? 'Definește un pachet nou pentru ofertă'
								: f.name || 'Pachet hosting'}
						</div>
					</div>
					<button
						type="button"
						class="hst-modal-close"
						title="Închide"
						aria-label="Închide"
						onclick={() => (editing = null)}
					>
						<XIcon size={14} />
					</button>
				</div>

				<div class="hst-modal-body two-col">
					<!-- Left: form -->
					<form
						id="product-form"
						class="hst-modal-form"
						onsubmit={(e) => {
							e.preventDefault();
							submitForm();
						}}
					>
						<div class="hst-section">
							<label class="hst-label" for="product-name">Identitate</label>
							<div class="hst-grid-2">
								<div>
									<label class="hst-label sm" for="product-name">Nume pachet *</label>
									<input
										id="product-name"
										class="hst-input"
										type="text"
										placeholder="ex: WordPress Pro"
										bind:value={f.name}
										required
									/>
								</div>
								<div>
									<div class="hst-label sm">Culoare brand</div>
									<div class="hst-color-grid" role="radiogroup" aria-label="Culoare brand">
										{#each PALETTE as c (c)}
											<button
												type="button"
												class="hst-color"
												class:selected={f.color === c}
												style:background={c}
												aria-label="Selectează culoare {c}"
												aria-pressed={f.color === c}
												title={c}
												onclick={() => (f.color = c)}
											></button>
										{/each}
									</div>
								</div>
							</div>
							<div>
								<label class="hst-label sm" for="product-desc">Tagline (apare sub nume)</label>
								<input
									id="product-desc"
									class="hst-input"
									type="text"
									placeholder="ex: Hosting WordPress optimizat pentru site-uri mici și medii"
									bind:value={f.description}
								/>
							</div>
							<div>
								<label class="hst-label sm" for="product-badge">
									Badge highlight (gol = fără badge)
								</label>
								<input
									id="product-badge"
									class="hst-input"
									type="text"
									placeholder="ex: Cel mai vândut · Recomandat"
									bind:value={f.highlightBadge}
								/>
							</div>
						</div>

						<div class="hst-section">
							<div class="hst-label">Prețuri</div>
							<div class="hst-grid-3">
								<div>
									<label class="hst-label sm" for="product-price">Preț ({f.currency})</label>
									<input
										id="product-price"
										class="hst-input"
										type="number"
										min="0"
										step="0.01"
										bind:value={f.price}
									/>
								</div>
								<div>
									<label class="hst-label sm" for="product-cycle">Ciclu facturare</label>
									<select id="product-cycle" class="hst-input" bind:value={f.billingCycle}>
										<option value="monthly">Lunar</option>
										<option value="quarterly">Trimestrial</option>
										<option value="biannually">Semestrial</option>
										<option value="annually">Anual</option>
										<option value="triennially">3 ani</option>
										<option value="one_time">O singură dată</option>
									</select>
								</div>
								<div>
									<label class="hst-label sm" for="product-currency">Monedă</label>
									<input
										id="product-currency"
										class="hst-input upper"
										type="text"
										maxlength="3"
										bind:value={f.currency}
									/>
								</div>
							</div>
							<div>
								<label class="hst-label sm" for="product-setup">Taxă setup (unică)</label>
								<input
									id="product-setup"
									class="hst-input"
									type="number"
									min="0"
									step="0.01"
									bind:value={f.setupFee}
								/>
							</div>
						</div>

						<div class="hst-section">
							<label class="hst-label" for="product-server">Link DirectAdmin</label>
							<div class="hst-grid-2">
								<div>
									<label class="hst-label sm" for="product-server">Server</label>
									<select
										id="product-server"
										class="hst-input"
										bind:value={f.daServerId}
										onchange={() => (f.daPackageId = '')}
									>
										<option value="">— fără link la server</option>
										{#await serversQuery}
											<option disabled>Se încarcă…</option>
										{:then list}
											{#each list as s (s.id)}
												<option value={s.id}>{s.name} ({s.hostname})</option>
											{/each}
										{:catch}
											<option disabled>Eroare la încărcare</option>
										{/await}
									</select>
								</div>
								<div>
									<label class="hst-label sm" for="product-package">Pachet DA (sursă limite)</label>
									<select
										id="product-package"
										class="hst-input"
										bind:value={f.daPackageId}
										disabled={!f.daServerId}
									>
										<option value="">— fără limite tehnice</option>
										{#each packages as pk (pk.id)}
											<option value={pk.id}>
												{pk.daName} ({mbToGb(pk.quota)} disk / {mbToGb(pk.bandwidth)} trafic)
											</option>
										{/each}
									</select>
								</div>
							</div>
							{#if !f.daServerId}
								<div class="hst-hint">Selectează întâi serverul pentru a vedea pachetele.</div>
							{/if}
						</div>

						<div class="hst-section">
							<label class="hst-label" for="product-features">Caracteristici afișate</label>
							<textarea
								id="product-features"
								class="hst-input mono"
								rows="6"
								placeholder={FEATURES_PLACEHOLDER}
								bind:value={f.featuresText}
							></textarea>
							<div class="hst-hint">O caracteristică pe linie. Apar ca bullets pe pagina publică.</div>
						</div>

						<div class="hst-section">
							<div class="hst-label">Opțiuni</div>
							<div class="hst-checks">
								<label class="hst-check">
									<input type="checkbox" bind:checked={f.isActive} />
									<span>
										<strong>Activ</strong> — apare în catalog și pe pagina publică
									</span>
								</label>
								<div class="hst-grid-2">
									<div>
										<label class="hst-label sm" for="product-sort">Ordine afișare</label>
										<input
											id="product-sort"
											class="hst-input"
											type="number"
											min="0"
											bind:value={f.sortOrder}
										/>
									</div>
								</div>
							</div>
						</div>
					</form>

					<!-- Right: live preview -->
					<aside class="hst-modal-preview">
						<div class="hst-label sm preview-label">Preview</div>
						<div class="hst-product" class:popular={popularSelected}>
							{#if popularSelected}
								<span class="hst-product-badge">{f.highlightBadge}</span>
							{/if}
							<div>
								<div class="hst-product-name">
									<span class="hst-product-color" style:background={f.color}></span>
									{f.name || 'Pachet nou'}
								</div>
								{#if f.description}
									<div class="hst-product-tag">{f.description}</div>
								{/if}
							</div>
							<div class="hst-product-price-block">
								<div class="hst-product-price">
									<span class="hst-product-price-val">{f.price || 0}</span>
									<span class="hst-product-price-cur">{f.currency || 'RON'}</span>
									<span class="hst-product-price-per">/ {cycleLabel(f.billingCycle)}</span>
								</div>
								{#if f.billingCycle === 'monthly' && f.price > 0}
									<div class="hst-product-year">≈ {yearEquivalent.toLocaleString('ro-RO')} {f.currency} / an</div>
								{/if}
							</div>
							{#if parseFeatures(f.featuresText).length > 0}
								<div class="hst-product-features">
									{#each parseFeatures(f.featuresText).slice(0, 5) as feat (feat)}
										<div class="hst-feat">
											<CheckIcon size={11} />
											<span>{feat}</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
						<div class="hst-preview-note">
							<strong>Cum apare:</strong> exact așa va fi vizibil în CRM și pe pagina publică
							<code>/pachete-hosting</code> după salvare.
						</div>
						<div
							class="hst-preview-status"
							class:on={f.isActive}
							class:off={!f.isActive}
						>
							{f.isActive
								? '✓ Pachet activ în catalog'
								: '⚠ Pachet inactiv — nu va apărea în catalog'}
						</div>
					</aside>
				</div>

				<div class="hst-modal-foot">
					<button type="button" class="btn-secondary" onclick={() => (editing = null)}>
						Anulează
					</button>
					<div class="hst-modal-foot-spacer"></div>
					<button
						type="submit"
						form="product-form"
						class="btn-primary"
						disabled={submitting || !f.name.trim() || f.price < 0}
					>
						<CheckIcon size={13} />
						{submitting
							? 'Se salvează…'
							: editing.mode === 'new'
							? 'Creează pachet'
							: editing.mode === 'duplicate'
							? 'Creează duplicat'
							: 'Salvează modificările'}
					</button>
				</div>
			</div>
		{/if}

		<!-- Delete modal -->
		{#if deleting}
			{@const delStat = statsFor(statsMap, deleting.id)}
			<div class="hst-modal-back" role="presentation" onclick={() => (deleting = null)}></div>
			<div
				class="hst-modal sm"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="delete-modal-title"
				use:focusTrap={{ active: true, onEscape: () => (deleting = null) }}
			>
				<div class="hst-modal-head">
					<div class="hst-modal-icon" style="background:linear-gradient(135deg, #ef4444, #b91c1c)">
						<AlertTriangleIcon size={18} />
					</div>
					<div class="hst-modal-head-text">
						<div class="hst-modal-title" id="delete-modal-title">
							Șterge pachetul „{deleting.name}"?
						</div>
						<div class="hst-modal-sub">Această acțiune nu poate fi anulată direct din UI.</div>
					</div>
					<button
						type="button"
						class="hst-modal-close"
						title="Închide"
						aria-label="Închide"
						onclick={() => (deleting = null)}
					>
						<XIcon size={14} />
					</button>
				</div>
				<div class="hst-modal-body">
					{#if delStat.sold > 0}
						<div class="hst-warn-box">
							<strong>Avertisment:</strong> există
							<strong>{delStat.sold} conturi active</strong> pe acest pachet, generând
							{fmtRON(delStat.mrrCents, deleting.currency)} MRR/lună. Ștergerea nu va afecta conturile
							existente, dar pachetul nu va mai putea fi comandat.
						</div>
					{:else}
						<div class="hst-info-box">
							Pachetul nu are conturi active, deci ștergerea este sigură.
						</div>
					{/if}
					<p class="hst-modal-text">
						Alternativ, poți <strong>marca pachetul ca inactiv</strong> — astfel nu mai apare în
						catalog, dar conturile existente continuă să funcționeze și să factureze normal.
					</p>
				</div>
				<div class="hst-modal-foot">
					<button type="button" class="btn-secondary" onclick={() => (deleting = null)}>
						Anulează
					</button>
					<div class="hst-modal-foot-spacer"></div>
					<button type="button" class="btn-secondary" onclick={() => confirmDelete('deactivate')}>
						Doar dezactivează
					</button>
					<button type="button" class="btn-danger" onclick={() => confirmDelete('delete')}>
						<Trash2Icon size={13} /> Șterge pachet
					</button>
				</div>
			</div>
		{/if}
	{:catch error}
		<div class="hst-empty">
			<AlertTriangleIcon size={36} />
			<div class="hst-empty-title">Eroare la încărcare</div>
			<div class="hst-empty-sub">{error instanceof Error ? error.message : 'Eroare necunoscută'}</div>
			<button type="button" class="btn-secondary" onclick={refresh}>Reîncearcă</button>
		</div>
	{/await}
</div>

<style>
	/*
	 * Hosting Products page — design pack v1
	 *
	 * Parent layout already applies p-6, so this page only sets inter-section
	 * gap, no outer padding. Matches the convention in /[tenant]/hosting/servers
	 * which is the canonical example for the design pack.
	 */
	.hst-page {
		font-family:
			'Inter',
			system-ui,
			-apple-system,
			sans-serif;
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
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
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
	.hst-empty-title {
		font-size: 15px;
		font-weight: 700;
		color: #0f172a;
	}
	.hst-empty-sub {
		font-size: 12.5px;
		color: #475569;
		max-width: 360px;
		margin: 0 auto;
	}

	/* ===== Hero ===== */
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
	.hst-link {
		color: #1877f2;
		text-decoration: none;
		font-weight: 600;
	}
	.hst-link:hover {
		text-decoration: underline;
	}
	.hst-hero-actions {
		margin-left: auto;
		display: flex;
		gap: 8px;
		align-items: center;
	}

	/* ===== Buttons ===== */
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
		white-space: nowrap;
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
		text-decoration: none;
		white-space: nowrap;
	}
	.btn-secondary:hover {
		border-color: #1877f2;
		color: #1877f2;
	}
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-danger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		background: #ef4444;
		color: white;
		border: none;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-danger:hover {
		background: #dc2626;
	}

	/* ===== KPIs ===== */
	.hst-kpis {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
	}
	.dash-kpi {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 10px;
		padding: 13px 14px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.dash-kpi-head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.dash-kpi-icon {
		width: 24px;
		height: 24px;
		border-radius: 6px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.dash-kpi-label {
		font-size: 10.5px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dash-kpi-value {
		font-size: 22px;
		font-weight: 800;
		color: #0f172a;
		letter-spacing: -0.02em;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dash-kpi-sub {
		font-size: 11px;
		color: #94a3b8;
	}

	/* ===== Toolbar ===== */
	.hst-toolbar {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.hst-toolbar-spacer {
		flex: 1;
	}
	.hst-view-toggle {
		display: inline-flex;
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
		font-size: 11.5px;
		font-weight: 600;
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

	/* ===== Products grid ===== */
	.hst-products-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 14px;
	}
	.hst-product {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 14px;
		padding: 22px 20px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		position: relative;
	}
	.hst-product.popular {
		border-color: #1877f2;
		box-shadow: 0 8px 24px rgba(24, 119, 242, 0.12);
	}
	.hst-product.inactive {
		opacity: 0.55;
	}
	.hst-product-badge {
		position: absolute;
		top: -10px;
		left: 20px;
		background: #1877f2;
		color: white;
		font-size: 10px;
		font-weight: 700;
		padding: 4px 10px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.hst-product-badge.muted {
		left: auto;
		right: 20px;
		background: #94a3b8;
	}
	.hst-product-color {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		display: inline-block;
	}
	.hst-product-name {
		font-size: 18px;
		font-weight: 700;
		color: #0f172a;
		letter-spacing: -0.01em;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.hst-product-tag {
		font-size: 12px;
		color: #475569;
		margin-top: 4px;
	}
	.hst-product-price-block {
		padding: 10px 0;
		border-top: 1px solid #f1f5f9;
		border-bottom: 1px solid #f1f5f9;
	}
	.hst-product-price {
		display: flex;
		align-items: baseline;
		gap: 4px;
	}
	.hst-product-price-val {
		font-size: 32px;
		font-weight: 800;
		color: #0f172a;
		letter-spacing: -0.02em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.hst-product-price-cur {
		font-size: 13px;
		font-weight: 600;
		color: #475569;
	}
	.hst-product-price-per {
		font-size: 11.5px;
		color: #94a3b8;
		margin-left: 4px;
	}
	.hst-product-year {
		font-size: 11px;
		color: #10b981;
		font-weight: 600;
		margin-top: 4px;
	}
	.hst-product-setup {
		font-size: 11px;
		color: #94a3b8;
		margin-top: 4px;
	}

	.hst-product-specs {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.hst-spec {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: #475569;
	}
	.hst-spec :global(svg) {
		color: #10b981;
		flex-shrink: 0;
	}
	.hst-spec strong {
		color: #0f172a;
		font-weight: 600;
	}

	.hst-product-features {
		padding: 10px 12px;
		background: #fafbfd;
		border: 1px solid #f1f5f9;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.hst-feat {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		font-size: 11.5px;
		color: #475569;
		line-height: 1.4;
	}
	.hst-feat :global(svg) {
		color: #10b981;
		flex-shrink: 0;
		margin-top: 2px;
	}
	.hst-feat-more {
		font-size: 11px;
		font-weight: 600;
		color: #94a3b8;
		margin-top: 2px;
	}

	.hst-product-server {
		font-size: 11px;
		color: #94a3b8;
		display: flex;
		gap: 4px;
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.hst-product-server-l {
		font-weight: 600;
		color: #94a3b8;
	}
	.hst-product-server-v strong {
		color: #475569;
	}
	.hst-pkg-inactive {
		color: #b45309;
		font-weight: 600;
		margin-left: 4px;
	}

	.hst-product-foot {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-top: 12px;
		border-top: 1px solid #f1f5f9;
		margin-top: auto;
	}
	.hst-product-stats {
		flex: 1;
		min-width: 0;
	}
	.hst-product-stat-l {
		font-size: 10px;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 700;
	}
	.hst-product-stat-v {
		font-size: 13px;
		font-weight: 700;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
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
		flex-shrink: 0;
	}
	.hst-icon-btn:hover {
		background: #1877f2;
		color: white;
		border-color: #1877f2;
	}
	.hst-icon-btn.sm {
		width: 22px;
		height: 22px;
		border-radius: 5px;
	}

	/* ===== Row menu ===== */
	.hst-menu-anchor {
		position: relative;
	}
	.hst-menu-back {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: transparent;
		border: none;
		padding: 0;
		cursor: default;
	}
	.hst-row-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 4px;
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 10px;
		box-shadow:
			0 12px 32px rgba(15, 23, 42, 0.12),
			0 4px 8px rgba(15, 23, 42, 0.04);
		padding: 4px;
		min-width: 220px;
		z-index: 50;
		display: flex;
		flex-direction: column;
	}
	.hst-row-menu button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border-radius: 6px;
		background: transparent;
		border: none;
		font-family: inherit;
		font-size: 12.5px;
		color: #475569;
		cursor: pointer;
		text-align: left;
	}
	.hst-row-menu button:hover {
		background: #f4f6fa;
		color: #0f172a;
	}
	.hst-row-menu button.danger {
		color: #ef4444;
	}
	.hst-row-menu button.danger:hover {
		background: #fef2f2;
	}
	.hst-row-menu hr {
		border: none;
		border-top: 1px solid #f1f5f9;
		margin: 4px 0;
	}

	/* ===== Comparison table ===== */
	.hst-table-wrap {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		overflow: auto;
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
	.hst-table-feat-col {
		min-width: 180px;
	}
	.hst-table-prod-col {
		text-align: center;
		min-width: 140px;
	}
	.hst-table-prod-head {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 6px;
		text-transform: none;
		letter-spacing: 0;
	}
	.hst-table-prod-color {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		display: inline-block;
	}
	.hst-table-prod-name {
		font-size: 12px;
		font-weight: 700;
		color: #0f172a;
	}
	.hst-table-pill {
		font-size: 9px;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 4px;
		letter-spacing: 0;
		color: white;
	}
	.hst-pill-top {
		background: #1877f2;
	}
	.hst-pill-off {
		background: #94a3b8;
	}
	.hst-table-prod-actions {
		display: flex;
		justify-content: center;
		gap: 3px;
		margin-top: 4px;
	}
	.hst-products-table tbody td {
		text-align: center;
	}
	.hst-products-table tbody td:first-child {
		text-align: left;
	}
	.hst-tcell-strong {
		font-weight: 700;
		color: #0f172a;
	}
	.hst-tcell-small {
		font-size: 11px;
	}
	.hst-tcell-mrr {
		color: #10b981;
	}
	.hst-tr-emph {
		background: #fafbfd;
	}
	.hst-feat-check :global(svg) {
		color: #10b981;
	}

	/* ===== Modal ===== */
	.hst-modal-back {
		position: fixed;
		inset: 0;
		z-index: 89;
		background: rgba(15, 23, 42, 0.45);
		backdrop-filter: blur(3px);
		animation: fadeIn 0.15s;
	}
	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.hst-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 760px;
		max-width: calc(100vw - 40px);
		max-height: calc(100vh - 60px);
		background: white;
		z-index: 90;
		border-radius: 14px;
		box-shadow:
			0 28px 64px rgba(15, 23, 42, 0.25),
			0 8px 20px rgba(15, 23, 42, 0.1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: popIn 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
	}
	.hst-modal.sm {
		width: 540px;
	}
	.hst-modal.lg {
		width: 980px;
		max-height: calc(100vh - 40px);
	}
	@keyframes popIn {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}
	.hst-modal-head {
		padding: 18px 22px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}
	.hst-modal-icon {
		width: 36px;
		height: 36px;
		border-radius: 9px;
		color: white;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.hst-modal-head-text {
		flex: 1;
		min-width: 0;
	}
	.hst-modal-title {
		font-size: 16px;
		font-weight: 700;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.hst-modal-sub {
		font-size: 12px;
		color: #94a3b8;
		margin-top: 2px;
	}
	.hst-modal-close {
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
	.hst-modal-close:hover {
		background: #f4f6fa;
		color: #0f172a;
	}

	.hst-modal-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px 22px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.hst-modal-body.two-col {
		flex-direction: row;
		gap: 0;
		padding: 0;
		overflow: hidden;
	}
	.hst-modal-form {
		flex: 1;
		min-width: 0;
		padding: 20px 22px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		overflow-y: auto;
	}
	.hst-modal-preview {
		width: 340px;
		background: #fafbfd;
		border-left: 1px solid #e5e9f0;
		padding: 20px 18px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow-y: auto;
		flex-shrink: 0;
	}
	.preview-label {
		margin-bottom: 0;
	}
	.hst-modal-preview .hst-product {
		padding: 20px 18px 18px;
		box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
		margin: 0;
	}
	.hst-preview-note {
		padding: 10px 12px;
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
		font-size: 11.5px;
		color: #475569;
	}
	.hst-preview-note strong {
		color: #0f172a;
	}
	.hst-preview-note code {
		background: #f4f6fa;
		padding: 1px 5px;
		border-radius: 3px;
		font-size: 10.5px;
		font-family: ui-monospace, monospace;
	}
	.hst-preview-status {
		padding: 10px 12px;
		border-radius: 8px;
		font-size: 11.5px;
	}
	.hst-preview-status.on {
		background: #ecfdf5;
		border: 1px solid rgba(16, 185, 129, 0.2);
		color: #047857;
	}
	.hst-preview-status.off {
		background: #fee2e2;
		border: 1px solid #fecaca;
		color: #b91c1c;
	}

	.hst-modal-foot {
		padding: 14px 22px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		gap: 10px;
		align-items: center;
		background: #fafbfd;
		flex-shrink: 0;
	}
	.hst-modal-foot-spacer {
		flex: 1;
	}

	/* ===== Form ===== */
	.hst-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.hst-label {
		font-size: 11.5px;
		font-weight: 700;
		color: #0f172a;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		display: block;
	}
	.hst-label.sm {
		font-size: 10.5px;
		font-weight: 600;
		color: #475569;
		margin-bottom: 4px;
	}
	.hst-hint {
		font-size: 11px;
		color: #94a3b8;
		line-height: 1.5;
	}
	.hst-input {
		width: 100%;
		padding: 10px 12px;
		background: white;
		border: 1px solid #d5dbe5;
		border-radius: 8px;
		font-family: inherit;
		font-size: 13px;
		color: #0f172a;
		outline: none;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.hst-input:focus {
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.hst-input::placeholder {
		color: #cbd5e1;
	}
	.hst-input.mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 12px;
	}
	.hst-input.upper {
		text-transform: uppercase;
	}
	textarea.hst-input {
		resize: vertical;
		min-height: 80px;
	}
	select.hst-input {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 14px center;
		padding-right: 36px;
	}
	.hst-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hst-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.hst-grid-3 {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 12px;
	}

	.hst-color-grid {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		padding-top: 4px;
	}
	.hst-color {
		width: 26px;
		height: 26px;
		border-radius: 7px;
		border: 2px solid transparent;
		cursor: pointer;
		outline: 2px solid transparent;
		transition:
			outline-color 0.12s,
			transform 0.12s;
		padding: 0;
	}
	.hst-color:hover {
		transform: scale(1.08);
	}
	.hst-color.selected {
		outline-color: #0f172a;
		outline-offset: 2px;
	}

	.hst-checks {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.hst-check {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
		cursor: pointer;
		font-size: 12.5px;
		color: #475569;
		transition: all 0.12s;
	}
	.hst-check:hover {
		border-color: #1877f2;
		background: rgba(24, 119, 242, 0.03);
	}
	.hst-check input[type='checkbox'] {
		width: 16px;
		height: 16px;
		margin: 0;
		accent-color: #1877f2;
	}

	.hst-warn-box {
		padding: 14px;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 10px;
		font-size: 13px;
		color: #b91c1c;
	}
	.hst-info-box {
		padding: 14px;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 10px;
		font-size: 13px;
		color: #92400e;
	}
	.hst-modal-text {
		font-size: 12.5px;
		color: #475569;
		margin: 0;
	}

	/* ===== Responsive ===== */
	@media (max-width: 1400px) {
		.hst-kpis {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	@media (max-width: 900px) {
		.hst-kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.hst-modal.lg {
			width: calc(100vw - 32px);
		}
		.hst-modal-body.two-col {
			flex-direction: column;
		}
		.hst-modal-preview {
			width: 100%;
			border-left: none;
			border-top: 1px solid #e5e9f0;
		}
	}
</style>
