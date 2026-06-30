<script lang="ts">
	// Modal "Comandă manuală" — înregistrează o comandă de hosting în numele unui
	// client, ocolind checkout-ul public. Sursă unică de adevăr: e folosit atât în
	// pagina Comenzi (/hosting/inquiries) cât și din butonul "Cont nou" al paginii
	// Provisioning (/hosting/provisioning). Backend real: createManualHostingOrder.
	import { toast } from 'svelte-sonner';
	import { focusTrap } from '$lib/actions/focus-trap';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { createManualHostingOrder } from '$lib/remotes/hosting-inquiries.remote';
	import { getHostingProducts } from '$lib/remotes/hosting-products.remote';
	import { getDAServers } from '$lib/remotes/da-servers.remote';
	import { validateCuiAndFetch } from '$lib/remotes/public-hosting.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { displayOrderId } from '$lib/utils/hosting-order-id';

	let {
		onClose,
		onCreated
	}: {
		/** Închide modalul (parintele controlează montarea via `{#if}`). */
		onClose: () => void;
		/** Apelat după ce comanda s-a creat cu succes — parintele își reîncarcă datele. */
		onCreated?: (result: { id: string; orderNumber: number | null }) => void;
	} = $props();

	// Date încărcate intern (query()-urile SvelteKit sunt cache-uite per-arg, deci
	// re-folosirea aceluiași getHostingProducts()/getDAServers() din pagini nu costă).
	let productsPromise = $state(getHostingProducts());
	let serversPromise = $state(getDAServers());
	// TVA dinamică: rata reală a tenant-ului (invoice_settings.defaultTaxRate).
	// Dacă o schimbi în setări, preview-ul se schimbă automat. NU hardcodăm.
	let settingsPromise = $state(getInvoiceSettings());

	let busy = $state(false);
	let draft = $state({
		client: '',
		email: '',
		type: 'person' as 'person' | 'company',
		cui: '',
		productId: '',
		period: 'yearly' as 'monthly' | 'yearly',
		domain: '',
		domainMode: 'buy' as 'buy' | 'have' | 'transfer',
		paymentMethod: 'card' as 'card' | 'op' | 'revolut' | 'paypal' | 'cash',
		initialStatus: 'paid' as 'paid' | 'pending' | 'processing',
		server: 'auto' as string,
		/** Dovadă plată (ref. tranzacție / OP / chitanță) — pentru card/bank/revolut/paypal. */
		paymentReference: ''
	});

	// Dovada plății: obligatorie când marcăm "Achitat" cu o metodă electronică/transfer
	// (card, OP bancar, Revolut, PayPal). Cash-ul are chitanță offline → fără câmp.
	const proofLabel = $derived(
		draft.paymentMethod === 'op'
			? 'Referință OP / extras bancar'
			: draft.paymentMethod === 'card'
				? 'ID tranzacție / chitanță POS'
				: draft.paymentMethod === 'revolut'
					? 'Referință Revolut'
					: draft.paymentMethod === 'paypal'
						? 'ID tranzacție PayPal'
						: 'Referință plată'
	);
	const proofPlaceholder = $derived(
		draft.paymentMethod === 'op'
			? 'ex: OP nr. 481 / extras BCR 26.05'
			: draft.paymentMethod === 'card'
				? 'ex: ch_3TZyAw… / bon POS 4242'
				: draft.paymentMethod === 'revolut'
					? 'ex: referință Revolut'
					: 'ex: ID tranzacție PayPal'
	);
	const proofVisible = $derived(draft.paymentMethod !== 'cash');
	const proofRequired = $derived(proofVisible && draft.initialStatus === 'paid');

	// === ANAF — auto-completare date firmă din CUI (ca în /pachete-hosting) ===
	type AnafData = {
		cui: string;
		vatNumber: string;
		denumire: string;
		adresa: string;
		nrRegCom: string;
		telefon: string;
		codPostal: string;
		platitorTva: boolean;
		eFacturaActiv: boolean;
	};
	let anafLoading = $state(false);
	let anafError = $state<string | null>(null);
	let anafData = $state<AnafData | null>(null);

	async function lookupAnaf() {
		anafError = null;
		const cui = draft.cui.trim();
		if (!cui) {
			anafError = 'Introdu un CUI mai întâi.';
			return;
		}
		anafLoading = true;
		try {
			const res = await validateCuiAndFetch(cui);
			if (!res.valid) {
				anafError = res.error;
				anafData = null;
				return;
			}
			anafData = res.data;
			// Auto-completează denumirea firmei + CUI normalizat (RO… dacă plătitor TVA).
			draft.client = res.data.denumire || draft.client;
			draft.cui = res.data.vatNumber;
		} catch (err) {
			anafError = err instanceof Error ? err.message : 'Eroare la verificare ANAF.';
		} finally {
			anafLoading = false;
		}
	}

	/** RON din bani (cents). Întoarce întreg când e foarte aproape, altfel 2 zecimale. */
	function fmtRon(amountCents: number | null | undefined): string {
		if (amountCents == null) return '—';
		const v = amountCents / 100;
		const rounded = Math.round(v);
		if (Math.abs(v - rounded) < 0.005) return `${rounded} RON`;
		return `${v.toFixed(2)} RON`;
	}

	const valid = $derived(
		!!draft.client.trim() &&
			!!draft.email.trim() &&
			!!draft.domain.trim() &&
			!!draft.productId &&
			(draft.type !== 'company' || !!draft.cui.trim()) &&
			(!proofRequired || !!draft.paymentReference.trim())
	);

	async function submit() {
		const d = draft;
		if (!d.client.trim() || !d.email.trim() || !d.domain.trim() || !d.productId) {
			toast.error('Completează toate câmpurile obligatorii');
			return;
		}
		if (d.type === 'company' && !d.cui.trim()) {
			toast.error('CUI obligatoriu pentru persoană juridică');
			return;
		}
		if (proofRequired && !d.paymentReference.trim()) {
			toast.error('Adaugă dovada plății (referință tranzacție / OP) pentru o plată achitată.');
			return;
		}
		busy = true;
		try {
			const r = await createManualHostingOrder({
				contactName: d.client.trim(),
				contactEmail: d.email.trim(),
				type: d.type,
				companyName: d.type === 'company' ? d.client.trim() : undefined,
				vatNumber: d.type === 'company' ? d.cui.trim() : undefined,
				hostingProductId: d.productId,
				period: d.period,
				domainName: d.domain.trim().toLowerCase(),
				domainMode: d.domainMode,
				paymentMethod: d.paymentMethod,
				initialStatus: d.initialStatus,
				server: d.server || undefined,
				paymentReference: d.paymentReference.trim() || undefined
			});
			const orderLabel = `${displayOrderId(r.orderNumber, r.id)} · ${d.client.trim()}`;
			if (r.provisioning?.provisioned) {
				// Pe "Achitat" s-a creat contul real pe DirectAdmin.
				toast.success(r.provisioning.created ? 'Cont DA creat' : 'Cont DA deja existent', {
					description: `${r.provisioning.daUsername} · ${r.provisioning.domain}`
				});
			} else if (r.provisioning && !r.provisioning.provisioned) {
				// Comanda e creată, dar provisioning-ul a eșuat — netfatal, retry din Comenzi.
				toast.warning('Comandă creată — provisioning eșuat', {
					description: r.provisioning.reason
				});
			} else {
				toast.success('Comandă creată manual', { description: orderLabel });
			}
			onCreated?.(r);
			onClose();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			busy = false;
		}
	}
</script>

<button class="ord-mo-back" aria-label="Închide" onclick={onClose}></button>
<div class="ord-mo" role="dialog" aria-label="Comandă manuală" use:focusTrap={{ initialFocus: '.ord-mo-close' }}>
	<div class="ord-mo-head">
		<div class="ord-mo-head-ic"><PlusIcon size={18} /></div>
		<div class="ord-mo-head-text">
			<h3>Comandă manuală</h3>
			<p>Înregistrează o comandă în numele unui client · ocolește checkout-ul public</p>
		</div>
		<button class="ord-mo-close" aria-label="Închide" onclick={onClose}>
			<XIcon size={14} />
		</button>
	</div>

	<div class="ord-mo-body">
		<!-- Client section -->
		<div class="ord-mo-section">
			<h5>Client</h5>
			<div class="ord-mo-seg ord-mo-section-mt-sm">
				<button type="button" class:active={draft.type === 'person'} onclick={() => (draft.type = 'person')}>
					Persoană fizică
				</button>
				<button type="button" class:active={draft.type === 'company'} onclick={() => (draft.type = 'company')}>
					Persoană juridică
				</button>
			</div>
			<div class="ord-mo-grid">
				<div>
					<label for="mo-client" class="ord-mo-label">
						{draft.type === 'company' ? 'Denumire firmă' : 'Nume complet'}
					</label>
					<input
						id="mo-client"
						class="ord-mo-input"
						placeholder={draft.type === 'company' ? 'Firma SRL' : 'Ion Popescu'}
						bind:value={draft.client}
					/>
				</div>
				<div>
					<label for="mo-email" class="ord-mo-label">Email</label>
					<input id="mo-email" class="ord-mo-input" placeholder="contact@…" bind:value={draft.email} />
				</div>
				{#if draft.type === 'company'}
					<div class="ord-mo-cui-cell">
						<label for="mo-cui" class="ord-mo-label">CUI</label>
						<div class="ord-mo-cui-row">
							<input
								id="mo-cui"
								class="ord-mo-input mono"
								placeholder="RO12345678"
								bind:value={draft.cui}
								onblur={() => {
									if (draft.cui.trim() && !anafData && !anafLoading) lookupAnaf();
								}}
							/>
							<button
								type="button"
								class="ord-mo-anaf-btn"
								onclick={lookupAnaf}
								disabled={anafLoading || !draft.cui.trim()}
							>
								{anafLoading ? 'Verifică…' : 'Verifică ANAF'}
							</button>
						</div>
						{#if anafError}
							<div class="ord-mo-anaf-err">{anafError}</div>
						{:else if anafData}
							<div class="ord-mo-anaf-ok">
								<strong>{anafData.denumire}</strong>
								{#if anafData.adresa}<span class="ord-mo-anaf-addr">{anafData.adresa}</span>{/if}
								<div class="ord-mo-anaf-tags">
									{#if anafData.platitorTva}<span class="ord-mo-anaf-tag">Plătitor TVA</span>{/if}
									{#if anafData.eFacturaActiv}<span class="ord-mo-anaf-tag">e-Factura</span>{/if}
									{#if anafData.nrRegCom}<span class="ord-mo-anaf-tag neutral">{anafData.nrRegCom}</span>{/if}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Plan section -->
		<div class="ord-mo-section">
			<h5>Pachet hosting</h5>
			{#await productsPromise}
				<div class="ord-mo-loading">Se încarcă pachetele…</div>
			{:then products}
				{@const visible = products.filter((p) => p.isActive)}
				<div class="ord-mo-plans">
					{#each visible as p (p.id)}
						<button
							type="button"
							class="ord-mo-plan"
							class:active={draft.productId === p.id}
							style="--c:#1877F2"
							onclick={() => (draft.productId = p.id)}
						>
							<span class="ord-mo-plan-sw"></span>
							<strong>{p.name}</strong>
							<span class="price">{fmtRon(p.price)}</span>
						</button>
					{/each}
				</div>
			{/await}
			<div class="ord-mo-section-mt-sm">
				<div class="ord-mo-label">Facturare</div>
				<div class="ord-mo-seg">
					<button type="button" class:active={draft.period === 'monthly'} onclick={() => (draft.period = 'monthly')}>
						Lunar
					</button>
					<button type="button" class:active={draft.period === 'yearly'} onclick={() => (draft.period = 'yearly')}>
						Anual <span class="ord-mo-seg-savings">–2 luni</span>
					</button>
				</div>
			</div>
		</div>

		<!-- Domain section -->
		<div class="ord-mo-section">
			<h5>Domeniu</h5>
			<div class="ord-mo-grid">
				<div>
					<label for="mo-domain" class="ord-mo-label">Nume domeniu</label>
					<input id="mo-domain" class="ord-mo-input mono" placeholder="exemplu.ro" bind:value={draft.domain} />
				</div>
				<div>
					<label for="mo-domain-mode" class="ord-mo-label">Mod</label>
					<select id="mo-domain-mode" class="ord-mo-select" bind:value={draft.domainMode}>
						<option value="buy">Cumpără nou (+49 RON)</option>
						<option value="transfer">Transfer (gratuit)</option>
						<option value="have">Există deja</option>
					</select>
				</div>
			</div>
		</div>

		<!-- Payment section -->
		<div class="ord-mo-section">
			<h5>Plată</h5>
			<div class="ord-mo-grid">
				<div>
					<label for="mo-method" class="ord-mo-label">Metodă</label>
					<select id="mo-method" class="ord-mo-select" bind:value={draft.paymentMethod}>
						<option value="card">Card</option>
						<option value="op">Ordin de plată</option>
						<option value="revolut">Revolut</option>
						<option value="paypal">PayPal</option>
						<option value="cash">Cash</option>
					</select>
				</div>
				<div>
					<label for="mo-status" class="ord-mo-label">Status inițial</label>
					<select id="mo-status" class="ord-mo-select" bind:value={draft.initialStatus}>
						<option value="paid">Achitat (provisionare imediată)</option>
						<option value="pending">În așteptare (proforma)</option>
						<option value="processing">Se procesează</option>
					</select>
				</div>
			</div>
			{#if proofVisible}
				<div class="ord-mo-proof ord-mo-section-mt-sm">
					<label for="mo-proof" class="ord-mo-label">
						Dovadă plată · {proofLabel}
						{#if proofRequired}<span class="ord-mo-req">*</span>{/if}
					</label>
					<input
						id="mo-proof"
						class="ord-mo-input mono"
						placeholder={proofPlaceholder}
						bind:value={draft.paymentReference}
					/>
					{#if proofRequired && !draft.paymentReference.trim()}
						<div class="ord-mo-proof-hint">Obligatoriu pentru o plată marcată „Achitat".</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Server section -->
		<div class="ord-mo-section">
			<h5>Server</h5>
			{#await serversPromise then servers}
				<select class="ord-mo-select" bind:value={draft.server} aria-label="Server">
					<option value="auto">Auto-alocare (recomandat)</option>
					{#each servers as s (s.id)}
						<option value={s.id}>{s.name}</option>
					{/each}
				</select>
			{/await}
		</div>

		<!-- Live summary -->
		{#await productsPromise then products}
			{#await settingsPromise then settings}
				{@const vatPct = settings.defaultTaxRate}
				{@const sel = products.find((p) => p.id === draft.productId)}
				{@const planAmount = sel ? sel.price : 0}
				{@const domCost = draft.domainMode === 'buy' ? 4900 : 0}
				{@const sub = planAmount + domCost}
				{@const moVat = Math.round((sub * vatPct) / 100)}
				{@const moTotal = sub + moVat}
				<div class="ord-mo-summary">
					<div class="row">
						<span
							>Hosting {sel?.name ?? '—'} ({draft.period === 'yearly' ? 'anual' : 'lunar'})</span
						>
						<strong>{fmtRon(planAmount)}</strong>
					</div>
					{#if domCost > 0}
						<div class="row">
							<span>Domeniu {draft.domain || '—'}</span>
							<strong>{fmtRon(domCost)}</strong>
						</div>
					{/if}
					<div class="row">
						<span>TVA {vatPct}%</span>
						<strong>{fmtRon(moVat)}</strong>
					</div>
					<div class="row big">
						<span>Total {draft.initialStatus === 'paid' ? 'achitat' : 'de plată'}</span>
						<strong>{fmtRon(moTotal)}</strong>
					</div>
				</div>
			{/await}
		{/await}
	</div>

	<div class="ord-mo-foot">
		<button class="btn-secondary" onclick={onClose}>Anulează</button>
		<div class="ord-mo-foot-spacer"></div>
		<button class="btn-primary" disabled={busy || !valid} onclick={submit}>
			<CheckIcon size={13} /> Creează comanda
		</button>
	</div>
</div>

<style>
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

	/* Manual order modal */
	.ord-mo-back {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.42);
		backdrop-filter: blur(2px);
		z-index: 80;
		border: 0;
		padding: 0;
	}
	.ord-mo {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 720px;
		max-width: calc(100vw - 48px);
		max-height: calc(100vh - 48px);
		background: white;
		border-radius: 14px;
		box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
		display: flex;
		flex-direction: column;
		z-index: 81;
		overflow: hidden;
	}
	.ord-mo-head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid #f1f5f9;
	}
	.ord-mo-head-ic {
		width: 38px;
		height: 38px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #1877f2, #0d5cc7);
		color: white;
	}
	.ord-mo-head-text {
		flex: 1;
	}
	.ord-mo-head h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		color: #0f172a;
	}
	.ord-mo-head p {
		margin: 2px 0 0;
		font-size: 12px;
		color: #94a3b8;
	}
	.ord-mo-close {
		width: 28px;
		height: 28px;
		border-radius: 7px;
		background: #f4f6fa;
		border: 0;
		color: #475569;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.ord-mo-close:hover {
		background: #e5e9f0;
		color: #0f172a;
	}
	.ord-mo-body {
		padding: 16px 20px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.ord-mo-foot {
		padding: 12px 20px;
		border-top: 1px solid #f1f5f9;
		display: flex;
		align-items: center;
		gap: 8px;
		background: #fafbfd;
	}
	.ord-mo-foot-spacer {
		flex: 1;
	}
	.ord-mo-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.ord-mo-label {
		font-size: 11px;
		color: #475569;
		font-weight: 600;
		display: block;
		margin-bottom: 5px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.ord-mo-input,
	.ord-mo-select {
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
	.ord-mo-input.mono {
		font-family: ui-monospace, monospace;
	}

	/* ANAF lookup (CUI) */
	.ord-mo-cui-cell {
		display: flex;
		flex-direction: column;
	}
	.ord-mo-cui-row {
		display: flex;
		gap: 6px;
	}
	.ord-mo-cui-row .ord-mo-input {
		flex: 1;
		min-width: 0;
	}
	.ord-mo-anaf-btn {
		flex-shrink: 0;
		border: 1px solid #e5e9f0;
		background: #f4f6fa;
		border-radius: 8px;
		padding: 0 11px;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
		white-space: nowrap;
	}
	.ord-mo-anaf-btn:hover:not(:disabled) {
		border-color: #1877f2;
		color: #1877f2;
	}
	.ord-mo-anaf-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.ord-mo-anaf-err {
		margin-top: 5px;
		font-size: 11.5px;
		color: #b91c1c;
	}
	.ord-mo-anaf-ok {
		margin-top: 6px;
		font-size: 12px;
		color: #0f172a;
	}
	.ord-mo-anaf-ok strong {
		display: block;
		font-weight: 600;
	}
	.ord-mo-anaf-addr {
		display: block;
		font-size: 11px;
		color: #94a3b8;
		margin-top: 1px;
	}
	.ord-mo-anaf-tags {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
		margin-top: 5px;
	}
	.ord-mo-anaf-tag {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 999px;
		background: rgba(16, 185, 129, 0.12);
		color: #047857;
	}
	.ord-mo-anaf-tag.neutral {
		background: #eef1f6;
		color: #475569;
		font-family: ui-monospace, monospace;
	}

	.ord-mo-proof {
		display: flex;
		flex-direction: column;
	}
	.ord-mo-req {
		color: #ef4444;
		font-weight: 700;
		margin-left: 2px;
	}
	.ord-mo-proof-hint {
		margin-top: 5px;
		font-size: 11px;
		color: #b45309;
	}
	.ord-mo-section {
		display: flex;
		flex-direction: column;
	}
	.ord-mo-section h5 {
		margin: 0 0 8px;
		font-size: 11px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.ord-mo-section-mt-sm {
		margin-top: 10px;
	}
	.ord-mo-plans {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}
	.ord-mo-plan {
		border: 1.5px solid #e5e9f0;
		border-radius: 10px;
		padding: 10px 8px;
		cursor: pointer;
		background: white;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 4px;
		transition: all 0.15s;
		font-family: inherit;
	}
	.ord-mo-plan:hover {
		border-color: #cbd5e1;
	}
	.ord-mo-plan.active {
		border-color: var(--c, #1877f2);
		background: color-mix(in srgb, var(--c, #1877f2) 6%, white);
	}
	.ord-mo-plan-sw {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--c, #1877f2);
	}
	.ord-mo-plan strong {
		font-size: 13px;
		color: #0f172a;
		font-weight: 700;
	}
	.ord-mo-plan .price {
		font-size: 11px;
		color: #475569;
		font-variant-numeric: tabular-nums;
	}
	.ord-mo-loading {
		font-size: 12px;
		color: #94a3b8;
		padding: 8px 0;
	}
	.ord-mo-seg {
		display: flex;
		gap: 4px;
		background: #f4f6fa;
		padding: 3px;
		border-radius: 8px;
	}
	.ord-mo-seg button {
		flex: 1;
		border: 0;
		background: transparent;
		padding: 7px 10px;
		border-radius: 6px;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #64748b;
		cursor: pointer;
	}
	.ord-mo-seg button.active {
		background: white;
		color: #0f172a;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
	}
	.ord-mo-seg-savings {
		color: #10b981;
		font-size: 10px;
		margin-left: 4px;
	}
	.ord-mo-summary {
		background: linear-gradient(135deg, #f0f4ff, #fafbfd);
		border: 1px solid #dbe6ff;
		border-radius: 10px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ord-mo-summary .row {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: #475569;
	}
	.ord-mo-summary .row strong {
		color: #0f172a;
		font-variant-numeric: tabular-nums;
	}
	.ord-mo-summary .row.big {
		font-size: 14px;
		padding-top: 6px;
		margin-top: 2px;
		border-top: 1px solid #dbe6ff;
	}
	.ord-mo-summary .row.big strong {
		font-size: 18px;
		font-weight: 800;
		color: #1877f2;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.ord-mo {
			width: calc(100vw - 24px);
		}
		.ord-mo-plans {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	/* Dark mode — modalul e construit pe paletă light; aliniem la tema dark a app-ului */
	:global(.dark) .ord-mo {
		background: #0f172a;
	}
	:global(.dark) .ord-mo-head,
	:global(.dark) .ord-mo-foot {
		border-color: #1e293b;
	}
	:global(.dark) .ord-mo-foot {
		background: #0b1220;
	}
	:global(.dark) .ord-mo-head h3 {
		color: #f1f5f9;
	}
	:global(.dark) .ord-mo-close {
		background: #1e293b;
		color: #cbd5e1;
	}
	:global(.dark) .ord-mo-close:hover {
		background: #334155;
		color: #f1f5f9;
	}
	:global(.dark) .ord-mo-input,
	:global(.dark) .ord-mo-select {
		background: #1e293b;
		border-color: #334155;
		color: #f1f5f9;
	}
	:global(.dark) .ord-mo-plan {
		background: #1e293b;
		border-color: #334155;
	}
	:global(.dark) .ord-mo-plan strong {
		color: #f1f5f9;
	}
	:global(.dark) .ord-mo-seg {
		background: #1e293b;
	}
	:global(.dark) .ord-mo-seg button.active {
		background: #334155;
		color: #f1f5f9;
	}
	:global(.dark) .btn-secondary {
		background: #1e293b;
		border-color: #334155;
		color: #cbd5e1;
	}
	:global(.dark) .ord-mo-anaf-btn {
		background: #1e293b;
		border-color: #334155;
		color: #cbd5e1;
	}
	:global(.dark) .ord-mo-anaf-ok {
		color: #f1f5f9;
	}
	:global(.dark) .ord-mo-anaf-tag.neutral {
		background: #334155;
		color: #cbd5e1;
	}
	:global(.dark) .ord-mo-summary {
		background: linear-gradient(135deg, #15233f, #0f172a);
		border-color: #1e3a5f;
	}
	:global(.dark) .ord-mo-summary .row strong {
		color: #f1f5f9;
	}
</style>
