<script lang="ts">
	import {
		getStripeIntegration,
		updateStripeIntegration,
		testStripeConnection,
		deactivateStripeIntegration,
		reactivateStripeIntegration
	} from '$lib/remotes/stripe-integration.remote';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import KeyIcon from '@lucide/svelte/icons/key';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';

	const tenantSlug = $derived(page.params.tenant);
	let integration = $state(getStripeIntegration());

	const webhookUrl = $derived(
		`${page.url.origin}/api/stripe/webhook`
	);

	let editing = $state(false);
	let secretKey = $state('');
	let publishableKey = $state('');
	let webhookSecret = $state('');
	let saving = $state(false);
	let testing = $state(false);

	function refresh() {
		integration = getStripeIntegration();
	}

	function openEdit() {
		secretKey = '';
		publishableKey = '';
		webhookSecret = '';
		editing = true;
	}

	async function save() {
		if (!secretKey || !publishableKey) {
			toast.error('Secret key și Publishable key sunt obligatorii.');
			return;
		}
		saving = true;
		try {
			const result = await updateStripeIntegration({
				secretKey,
				publishableKey,
				webhookSecret: webhookSecret || undefined
			});
			toast.success(
				result.accountName
					? `Conectat la "${result.accountName}" (${result.isTestMode ? 'TEST' : 'LIVE'})`
					: `Conectat în mode ${result.isTestMode ? 'TEST' : 'LIVE'}`
			);
			editing = false;
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}

	async function runTest() {
		testing = true;
		try {
			const r = await testStripeConnection();
			toast.success(
				`OK — conectat la ${r.accountName ?? r.accountId} (${r.country}, ${r.defaultCurrency?.toUpperCase()})`
			);
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare test');
		} finally {
			testing = false;
		}
	}

	async function deactivate() {
		if (!confirm('Sigur dezactivezi integrarea Stripe? Plățile noi vor fi blocate.')) return;
		try {
			await deactivateStripeIntegration();
			toast.success('Stripe dezactivat');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function reactivate() {
		try {
			await reactivateStripeIntegration();
			toast.success('Stripe reactivat');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	function copyWebhook() {
		navigator.clipboard.writeText(webhookUrl);
		toast.success('URL webhook copiat în clipboard');
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">Stripe</h1>
		<p class="text-slate-500">
			Conectează contul tău Stripe pentru a primi plăți online de la clienți.
		</p>
	</div>

	{#await integration}
		<div class="rounded-xl border bg-white p-8 text-center text-slate-500 dark:bg-slate-800">
			Se încarcă...
		</div>
	{:then row}
		{#if !row && !editing}
			<!-- Empty state: nu există integrare -->
			<div class="rounded-xl border bg-white p-8 dark:bg-slate-800">
				<div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
					<AlertCircleIcon class="size-6" />
				</div>
				<h2 class="text-center text-lg font-semibold">Stripe nu e configurat</h2>
				<p class="mt-2 text-center text-sm text-slate-500">
					Lipește cheile API din Stripe Dashboard ca să poți primi plăți.
				</p>
				<div class="mt-6 flex justify-center">
					<button
						onclick={openEdit}
						class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
					>
						<KeyIcon class="size-4" /> Conectează Stripe
					</button>
				</div>
			</div>
		{:else if row && !editing}
			<!-- Status existing integration -->
			<div class="rounded-xl border bg-white dark:bg-slate-800">
				<div class="flex items-start justify-between gap-4 border-b p-5">
					<div class="flex items-start gap-3">
						{#if row.isActive}
							<div class="rounded-full bg-green-100 p-2 text-green-600">
								<CheckCircleIcon class="size-5" />
							</div>
						{:else}
							<div class="rounded-full bg-slate-100 p-2 text-slate-500">
								<XCircleIcon class="size-5" />
							</div>
						{/if}
						<div>
							<h2 class="text-lg font-semibold">
								{row.accountName || 'Cont Stripe conectat'}
							</h2>
							<div class="mt-1 flex items-center gap-2 text-xs">
								<span
									class="rounded-full {row.isTestMode
										? 'bg-amber-100 text-amber-700'
										: 'bg-green-100 text-green-700'} px-2 py-0.5"
								>
									{row.isTestMode ? 'TEST MODE' : 'LIVE MODE'}
								</span>
								{#if row.isActive}
									<span class="text-green-600">Activ</span>
								{:else}
									<span class="text-slate-500">Dezactivat</span>
								{/if}
							</div>
							{#if row.accountId}
								<p class="mt-1 font-mono text-xs text-slate-500">{row.accountId}</p>
							{/if}
						</div>
					</div>
					<div class="flex gap-2">
						<button
							onclick={runTest}
							disabled={testing}
							class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
						>
							<RefreshIcon class="size-4 {testing ? 'animate-spin' : ''}" />
							Test
						</button>
						<button
							onclick={openEdit}
							class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
						>
							Schimbă cheile
						</button>
					</div>
				</div>

				<div class="grid gap-3 p-5 text-sm sm:grid-cols-2">
					<div>
						<div class="text-xs uppercase text-slate-500">Publishable Key</div>
						<div class="mt-1 font-mono text-xs">{row.publishableKeyMasked}</div>
					</div>
					<div>
						<div class="text-xs uppercase text-slate-500">Webhook Secret</div>
						<div class="mt-1 text-xs">
							{#if row.hasWebhookSecret}
								<span class="text-green-600">✓ Configurat</span>
							{:else}
								<span class="text-amber-600">Nu e configurat (vezi mai jos)</span>
							{/if}
						</div>
					</div>
					{#if row.accountEmail}
						<div>
							<div class="text-xs uppercase text-slate-500">Email cont</div>
							<div class="mt-1 text-xs">{row.accountEmail}</div>
						</div>
					{/if}
					<div>
						<div class="text-xs uppercase text-slate-500">Ultima verificare</div>
						<div class="mt-1 text-xs">
							{row.lastTestedAt
								? new Date(row.lastTestedAt).toLocaleString('ro-RO')
								: '—'}
						</div>
					</div>
				</div>

				{#if row.lastError}
					<div class="mx-5 mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
						<strong>Ultima eroare:</strong>
						{row.lastError}
					</div>
				{/if}

				<div class="border-t bg-slate-50 px-5 py-3 dark:bg-slate-900/50">
					{#if row.isActive}
						<button onclick={deactivate} class="text-sm text-red-600 hover:underline">
							Dezactivează plugin-ul
						</button>
					{:else}
						<button onclick={reactivate} class="text-sm text-green-600 hover:underline">
							Reactivează
						</button>
					{/if}
				</div>
			</div>

			<!-- Webhook setup info -->
			<div class="rounded-xl border bg-blue-50 p-5 dark:bg-blue-950/30">
				<h3 class="font-semibold">Configurează webhook în Stripe Dashboard</h3>
				<p class="mt-2 text-sm text-slate-600 dark:text-slate-300">
					În Stripe Dashboard → <strong>Developers → Webhooks → Add endpoint</strong>, lipește:
				</p>
				<div class="mt-3 flex gap-2">
					<code class="flex-1 rounded bg-white px-3 py-2 text-sm font-mono dark:bg-slate-900">
						{webhookUrl}
					</code>
					<button
						onclick={copyWebhook}
						class="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
					>
						<CopyIcon class="size-4" /> Copy
					</button>
				</div>
				<p class="mt-3 text-xs text-slate-500">
					Events de selectat: <code>checkout.session.completed</code>,
					<code>invoice.paid</code>, <code>invoice.payment_failed</code>,
					<code>customer.subscription.deleted</code>. După salvare, copiază
					<code>whsec_...</code> și lipește-l aici la "Webhook Secret".
				</p>
			</div>
		{:else if editing}
			<!-- Edit form -->
			<form
				onsubmit={(e) => {
					e.preventDefault();
					save();
				}}
				class="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-800"
			>
				<h2 class="text-lg font-semibold">Conectează Stripe</h2>
				<p class="text-sm text-slate-500">
					Din Stripe Dashboard → Developers → API keys. Pentru test, folosește chei
					<code>sk_test_</code> și <code>pk_test_</code>.
				</p>

				<div>
					<label for="secret" class="mb-1 block text-sm font-medium">
						Secret key * (sk_test_ sau sk_live_)
					</label>
					<input
						id="secret"
						type="password"
						bind:value={secretKey}
						placeholder="sk_test_..."
						required
						class="w-full rounded-lg border px-3 py-2 font-mono text-sm dark:bg-slate-900"
					/>
				</div>

				<div>
					<label for="pub" class="mb-1 block text-sm font-medium">
						Publishable key * (pk_test_ sau pk_live_)
					</label>
					<input
						id="pub"
						bind:value={publishableKey}
						placeholder="pk_test_..."
						required
						class="w-full rounded-lg border px-3 py-2 font-mono text-sm dark:bg-slate-900"
					/>
				</div>

				<div>
					<label for="whsec" class="mb-1 block text-sm font-medium">
						Webhook Secret <span class="text-xs text-slate-500">(opțional acum, obligatoriu pentru
							webhook funcțional)</span>
					</label>
					<input
						id="whsec"
						type="password"
						bind:value={webhookSecret}
						placeholder="whsec_..."
						class="w-full rounded-lg border px-3 py-2 font-mono text-sm dark:bg-slate-900"
					/>
					<p class="mt-1 text-xs text-slate-500">
						Lasă gol acum dacă nu ai creat încă webhook-ul. După salvare vei vedea URL-ul pe
						care să-l configurezi în Stripe Dashboard.
					</p>
				</div>

				<div class="flex justify-end gap-2 pt-2">
					<button
						type="button"
						onclick={() => (editing = false)}
						class="rounded-lg border px-4 py-2 text-sm">Anulează</button
					>
					<button
						type="submit"
						disabled={saving}
						class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{saving ? 'Se testează și salvează...' : 'Salvează & Conectează'}
					</button>
				</div>
			</form>
		{/if}
	{/await}
</div>
