<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		getHostingProducts,
		createHostingProduct,
		updateHostingProduct,
		deleteHostingProduct
	} from '$lib/remotes/hosting-products.remote';
	import { getDAServers, getDAPackagesForServer } from '$lib/remotes/da-servers.remote';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import MailIcon from '@lucide/svelte/icons/mail';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import GlobeIcon from '@lucide/svelte/icons/globe';

	type BillingCycle =
		| 'monthly'
		| 'quarterly'
		| 'annually'
		| 'biannually'
		| 'triennially'
		| 'one_time';

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
	};

	const emptyForm: FormState = {
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
		isActive: true
	};

	let products = $state(getHostingProducts());
	const servers = $derived(getDAServers());

	let showForm = $state(false);
	let form = $state<FormState>({ ...emptyForm });
	let submitting = $state(false);

	let packagesQuery = $state<ReturnType<typeof getDAPackagesForServer> | null>(null);
	$effect(() => {
		if (form.daServerId) {
			packagesQuery = getDAPackagesForServer(form.daServerId);
		} else {
			packagesQuery = null;
		}
	});
	const packages = $derived(packagesQuery?.current ?? []);

	function refresh() {
		products = getHostingProducts();
	}

	function openCreateForm() {
		form = { ...emptyForm };
		showForm = true;
	}

	function openEditForm(p: {
		id: string;
		name: string;
		description: string | null;
		features: string[] | null;
		highlightBadge: string | null;
		sortOrder: number;
		daServerId: string | null;
		daPackageId: string | null;
		price: number;
		currency: string;
		billingCycle: string;
		setupFee: number;
		isActive: boolean;
	}) {
		form = {
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
			isActive: p.isActive
		};
		showForm = true;
	}

	function parseFeatures(text: string): string[] {
		return text
			.split('\n')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	}

	async function submit() {
		submitting = true;
		try {
			const payload = {
				name: form.name,
				description: form.description.trim() || undefined,
				features: parseFeatures(form.featuresText),
				highlightBadge: form.highlightBadge.trim() || undefined,
				sortOrder: form.sortOrder,
				daServerId: form.daServerId || undefined,
				daPackageId: form.daPackageId || undefined,
				price: Math.round(form.price * 100),
				currency: form.currency,
				billingCycle: form.billingCycle,
				setupFee: Math.round(form.setupFee * 100),
				isActive: form.isActive
			};

			if (form.id) {
				await updateHostingProduct({ id: form.id, data: payload });
				toast.success('Produs actualizat');
			} else {
				await createHostingProduct(payload);
				toast.success('Produs adăugat');
			}
			showForm = false;
			form = { ...emptyForm };
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			submitting = false;
		}
	}

	async function handleDelete(id: string) {
		if (!confirm('Dezactivezi acest produs?')) return;
		try {
			await deleteHostingProduct(id);
			toast.success('Produs dezactivat');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	function formatRON(cents: number, currency: string) {
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(cents / 100);
	}

	function fmtLimit(value: number | null, unit?: string): string {
		if (value === null || value === undefined) return 'Nelimitat';
		const formatted = value.toLocaleString('ro-RO');
		return unit ? `${formatted} ${unit}` : formatted;
	}

	function billingCycleLabel(cycle: string): string {
		switch (cycle) {
			case 'monthly':
				return 'Lunar';
			case 'quarterly':
				return 'Trimestrial';
			case 'semiannually':
			case 'biannually':
				return 'Semestrial';
			case 'annually':
				return 'Anual';
			case 'triennially':
				return '3 ani';
			case 'one_time':
				return 'O singură dată';
			default:
				return cycle;
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">Produse Hosting</h1>
			<p class="text-slate-500">Pachetele pe care le facturezi clienților. Limitele tehnice vin din DirectAdmin.</p>
		</div>
		<button
			onclick={openCreateForm}
			class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
		>
			<PlusIcon class="size-4" /> Produs nou
		</button>
	</div>

	{#if showForm}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				submit();
			}}
			class="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-800"
		>
			<h2 class="text-lg font-semibold">{form.id ? 'Editează produs' : 'Adaugă produs'}</h2>
			<div class="grid grid-cols-2 gap-4">
				<div class="col-span-2">
					<label class="mb-1 block text-sm font-medium" for="name">Nume *</label>
					<input
						id="name"
						bind:value={form.name}
						required
						placeholder="ex: Wordpress Standard"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
				<div class="col-span-2">
					<label class="mb-1 block text-sm font-medium" for="desc"
						>Descriere scurtă <span class="text-xs text-slate-500">(text simplu, NU HTML)</span></label
					>
					<textarea
						id="desc"
						bind:value={form.description}
						rows="2"
						placeholder="ex: Hosting WordPress optimizat pentru site-uri mici și medii"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					></textarea>
				</div>
				<div class="col-span-2">
					<label class="mb-1 block text-sm font-medium" for="features"
						>Caracteristici <span class="text-xs text-slate-500">(o per linie — apar ca bullets)</span></label
					>
					<textarea
						id="features"
						bind:value={form.featuresText}
						rows="6"
						placeholder={'Backup zilnic\nWordpress Toolkit\nTransfer hosting gratuit\nLitespeed + LS Cache\nSecuritate prin Imunify360\nCertificat SSL Gratuit\nSupport în română'}
						class="w-full rounded-lg border px-3 py-2 font-mono text-sm dark:bg-slate-900"
					></textarea>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="server">Server DirectAdmin</label>
					<select
						id="server"
						bind:value={form.daServerId}
						onchange={() => (form.daPackageId = '')}
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					>
						<option value="">— (fără link la server)</option>
						{#await servers}
							<option disabled>Se încarcă...</option>
						{:then list}
							{#each list as s (s.id)}
								<option value={s.id}>{s.name} ({s.hostname})</option>
							{/each}
						{/await}
					</select>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="pkg">Pachet DA (sursă limite)</label>
					<select
						id="pkg"
						bind:value={form.daPackageId}
						disabled={!form.daServerId}
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900 disabled:opacity-50"
					>
						<option value="">— (fără limite tehnice)</option>
						{#each packages as p (p.id)}
							<option value={p.id}
								>{p.daName} ({fmtLimit(p.quota, 'MB')} disk / {fmtLimit(p.bandwidth, 'MB')} trafic)</option
							>
						{/each}
					</select>
					{#if !form.daServerId}
						<p class="mt-1 text-xs text-slate-500">Selectează întâi serverul.</p>
					{/if}
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="price">Preț ({form.currency})</label>
					<input
						id="price"
						type="number"
						step="0.01"
						min="0"
						bind:value={form.price}
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="cycle">Ciclu facturare</label>
					<select
						id="cycle"
						bind:value={form.billingCycle}
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					>
						<option value="monthly">Lunar</option>
						<option value="quarterly">Trimestrial</option>
						<option value="biannually">Semestrial</option>
						<option value="annually">Anual</option>
						<option value="triennially">3 ani</option>
						<option value="one_time">O singură dată</option>
					</select>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="setup">Taxă setup</label>
					<input
						id="setup"
						type="number"
						step="0.01"
						min="0"
						bind:value={form.setupFee}
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="currency">Monedă</label>
					<input
						id="currency"
						bind:value={form.currency}
						maxlength="3"
						class="w-full rounded-lg border px-3 py-2 uppercase dark:bg-slate-900"
					/>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="badge"
						>Badge <span class="text-xs text-slate-500">(opțional)</span></label
					>
					<input
						id="badge"
						bind:value={form.highlightBadge}
						placeholder="ex: Cel mai vândut"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="sort">Ordine afișare</label>
					<input
						id="sort"
						type="number"
						min="0"
						bind:value={form.sortOrder}
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
				<div class="col-span-2 flex items-center gap-2">
					<input id="active" type="checkbox" bind:checked={form.isActive} />
					<label for="active" class="text-sm">Activ (vizibil în portal client)</label>
				</div>
			</div>
			<div class="flex gap-2">
				<button
					type="submit"
					disabled={submitting}
					class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
				>
					{submitting ? 'Se salvează...' : form.id ? 'Salvează' : 'Adaugă'}
				</button>
				<button
					type="button"
					onclick={() => {
						showForm = false;
						form = { ...emptyForm };
					}}
					class="rounded-lg border px-4 py-2 text-sm">Anulează</button
				>
			</div>
		</form>
	{/if}

	<div class="space-y-3">
		{#await products}
			<div class="rounded-xl border bg-white p-8 text-center text-slate-500 dark:bg-slate-800">
				Se încarcă...
			</div>
		{:then list}
			{#if list.length === 0}
				<div class="rounded-xl border bg-white p-12 text-center text-slate-500 dark:bg-slate-800">
					Niciun produs.
				</div>
			{:else}
				{#each list as p (p.id)}
					<div
						class="overflow-hidden rounded-xl border bg-white dark:bg-slate-800 {p.isActive
							? ''
							: 'opacity-60'}"
					>
						<div class="flex items-start justify-between gap-3 p-5">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<h3 class="text-lg font-semibold">{p.name}</h3>
									{#if p.highlightBadge}
										<span
											class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
											>{p.highlightBadge}</span
										>
									{/if}
									{#if !p.isActive}
										<span
											class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-700"
											>Inactiv</span
										>
									{/if}
								</div>
								{#if p.description}
									<p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.description}</p>
								{/if}
								{#if p.serverName || p.packageName}
									<p class="mt-1 text-xs text-slate-500">
										{p.serverName ?? '—'} · pachet DA: <span class="font-medium"
											>{p.packageName ?? 'nelegat'}</span
										>
										{#if p.packageName && p.pkgIsActive === false}
											<span class="ml-1 text-amber-600">(pachet DA inactiv)</span>
										{/if}
									</p>
								{/if}
							</div>
							<div class="flex items-start gap-3">
								<div class="text-right">
									<div class="text-xl font-bold">{formatRON(p.price, p.currency)}</div>
									<div class="text-xs text-slate-500">{billingCycleLabel(p.billingCycle)}</div>
									{#if p.setupFee > 0}
										<div class="text-xs text-slate-400">
											+ setup {formatRON(p.setupFee, p.currency)}
										</div>
									{/if}
								</div>
								<button
									onclick={() => openEditForm(p)}
									class="rounded p-1.5 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
									title="Editează"
								>
									<PencilIcon class="size-4" />
								</button>
								<button
									onclick={() => handleDelete(p.id)}
									class="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
									title="Dezactivează"
								>
									<Trash2Icon class="size-4" />
								</button>
							</div>
						</div>

						{#if p.features && p.features.length > 0}
							<div class="border-t bg-slate-50 px-5 py-3 dark:bg-slate-900/50">
								<ul class="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
									{#each p.features as feat}
										<li class="flex items-start gap-1.5">
											<span class="text-green-600 dark:text-green-400">✓</span>
											<span>{feat}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if p.daPackageId}
							<div class="border-t bg-slate-50/50 px-5 py-3 dark:bg-slate-900/30">
								<div
									class="grid grid-cols-2 gap-3 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-3 lg:grid-cols-6"
								>
									<div class="flex items-center gap-1.5">
										<HardDriveIcon class="size-3" />
										<span>Disk: <strong>{fmtLimit(p.pkgQuota, 'MB')}</strong></span>
									</div>
									<div class="flex items-center gap-1.5">
										<ActivityIcon class="size-3" />
										<span>Trafic: <strong>{fmtLimit(p.pkgBandwidth, 'MB')}</strong></span>
									</div>
									<div class="flex items-center gap-1.5">
										<MailIcon class="size-3" />
										<span>Email: <strong>{fmtLimit(p.pkgMaxEmailAccounts)}</strong></span>
									</div>
									<div class="flex items-center gap-1.5">
										<DatabaseIcon class="size-3" />
										<span>DB: <strong>{fmtLimit(p.pkgMaxDatabases)}</strong></span>
									</div>
									<div class="flex items-center gap-1.5">
										<GlobeIcon class="size-3" />
										<span>Domenii: <strong>{fmtLimit(p.pkgMaxDomains)}</strong></span>
									</div>
									<div class="flex items-center gap-1.5">
										<GlobeIcon class="size-3" />
										<span>Subdomenii: <strong>{fmtLimit(p.pkgMaxSubdomains)}</strong></span>
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		{/await}
	</div>
</div>
