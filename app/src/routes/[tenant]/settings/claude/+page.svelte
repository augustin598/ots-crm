<!-- src/routes/[tenant]/settings/claude/+page.svelte -->
<script lang="ts">
	import {
		getClaudeIntegration,
		saveClaudeIntegration,
		testClaudeConnection,
		deleteClaudeIntegration
	} from '$lib/remotes/claude-integration.remote';
	import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '$lib/claude-models';
	import { toast } from 'svelte-sonner';
	import KeyIcon from '@lucide/svelte/icons/key';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import TerminalIcon from '@lucide/svelte/icons/terminal';

	const integrationQuery = getClaudeIntegration();
	const current = $derived(integrationQuery.current ?? null);
	const loading = $derived(integrationQuery.loading);

	let apiKey = $state('');
	let defaultModel = $state<string>(DEFAULT_CLAUDE_MODEL);
	let modelInitialized = $state(false);
	let saving = $state(false);
	let testing = $state(false);
	let deleting = $state(false);

	// Detecție live a tipului de cheie după prefix (client-side, doar pentru UI).
	const keyPreview = $derived(
		!apiKey.trim()
			? null
			: apiKey.trim().startsWith('sk-ant-oat')
				? 'oat'
				: apiKey.trim().startsWith('sk-ant-')
					? 'api'
					: 'unknown'
	);

	// Pre-umple dropdown-ul cu modelul salvat, o singură dată.
	$effect(() => {
		if (current && !modelInitialized) {
			defaultModel = current.defaultModel ?? DEFAULT_CLAUDE_MODEL;
			modelInitialized = true;
		}
	});

	async function save() {
		saving = true;
		try {
			await saveClaudeIntegration({ apiKey: apiKey.trim(), defaultModel }).updates(integrationQuery);
			toast.success('Cheia Claude a fost salvată.');
			apiKey = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}

	async function runTest() {
		testing = true;
		try {
			const r = await testClaudeConnection().updates(integrationQuery);
			toast.success(
				r.via === 'models'
					? `OK — cheie validă (${r.models.length} modele disponibile).`
					: 'OK — cheie validă (verificat prin planul Claude).'
			);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Test eșuat');
		} finally {
			testing = false;
		}
	}

	async function remove() {
		if (!confirm('Sigur ștergi cheia Claude a acestui tenant?')) return;
		deleting = true;
		try {
			await deleteClaudeIntegration().updates(integrationQuery);
			toast.success('Cheia Claude a fost ștearsă.');
			apiKey = '';
			defaultModel = DEFAULT_CLAUDE_MODEL;
			modelInitialized = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			deleting = false;
		}
	}
</script>

<div class="claude-cfg">
	<header class="cc-head">
		<div class="cc-head-ic"><SparklesIcon class="h-5 w-5" /></div>
		<div>
			<h2>Claude</h2>
			<p>Conectează Claude (Anthropic). Cheia e criptată per-tenant și nu părăsește serverul.</p>
		</div>
	</header>

	{#if current?.connected}
		<div class="cc-status">
			<span class="cc-badge">
				<CheckCircleIcon class="h-3.5 w-3.5" /> Conectat
			</span>
			<span class="cc-status-key">
				{current.keyType === 'oat' ? 'Planul Claude (OAuth)' : 'API key'} · …{current.keyHint}
			</span>
			{#if current.lastTestedAt}
				<span class="cc-status-tested">
					testat {new Date(current.lastTestedAt).toLocaleString('ro-RO')}
				</span>
			{/if}
			{#if current.lastError}
				<div class="cc-alert">
					<AlertCircleIcon class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{current.lastError}</span>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Cele două moduri de conectare -->
	<div class="cc-modes">
		<div class="cc-mode" class:sel={keyPreview === 'api'}>
			<div class="cc-mode-top">
				<span class="cc-mode-ic api"><KeyIcon class="h-4 w-4" /></span>
				<span class="cc-mode-title">API key</span>
			</div>
			<code class="cc-code">sk-ant-api03-…</code>
			<p class="cc-mode-desc">De pe <strong>console.anthropic.com</strong>. Consumă credite API.</p>
		</div>

		<div class="cc-mode" class:sel={keyPreview === 'oat'}>
			<div class="cc-mode-top">
				<span class="cc-mode-ic plan"><SparklesIcon class="h-4 w-4" /></span>
				<span class="cc-mode-title">Planul Claude</span>
				<span class="cc-mode-tag">abonament</span>
			</div>
			<code class="cc-code">sk-ant-oat01-…</code>
			<p class="cc-mode-desc">
				Rulează <span class="cc-kbd"><TerminalIcon class="h-3 w-3" /> claude setup-token</span> în
				terminal. Folosește abonamentul Pro/Max, nu credite.
			</p>
		</div>
	</div>

	<!-- Formular -->
	<div class="cc-form">
		<div class="cc-field">
			<label for="claude-key">Cheie Claude</label>
			<input
				id="claude-key"
				type="password"
				bind:value={apiKey}
				placeholder={current?.connected
					? 'Lasă gol ca să păstrezi cheia actuală'
					: 'sk-ant-api03-…  sau  sk-ant-oat01-…'}
				autocomplete="off"
				spellcheck="false"
				disabled={loading}
			/>
			{#if keyPreview === 'oat'}
				<p class="cc-detect plan">
					<SparklesIcon class="h-3.5 w-3.5" /> Token OAuth detectat → va folosi <strong
						>planul tău Claude</strong
					>
				</p>
			{:else if keyPreview === 'api'}
				<p class="cc-detect api">
					<KeyIcon class="h-3.5 w-3.5" /> API key detectată → va folosi <strong>credite API</strong>
				</p>
			{:else if keyPreview === 'unknown'}
				<p class="cc-detect warn">
					<AlertCircleIcon class="h-3.5 w-3.5" /> Cheia trebuie să înceapă cu <code>sk-ant-…</code>
				</p>
			{:else}
				<p class="cc-hint">Lipești oricare din cele două chei de mai sus — se detectează automat.</p>
			{/if}
		</div>

		<div class="cc-field">
			<label for="claude-model">Model implicit</label>
			<select id="claude-model" bind:value={defaultModel} disabled={loading} class="cc-select">
				{#each CLAUDE_MODELS as m (m.id)}
					<option value={m.id}>{m.label}</option>
				{/each}
			</select>
		</div>

		<div class="cc-actions">
			<button class="cc-btn primary" onclick={save} disabled={saving || loading}>
				<KeyIcon class="h-4 w-4" />
				{saving ? 'Se salvează…' : 'Salvează'}
			</button>
			{#if current?.connected}
				<button class="cc-btn ghost" onclick={runTest} disabled={testing}>
					<span class="cc-tico" class:cc-spin={testing}><RefreshIcon class="h-4 w-4" /></span>
					{testing ? 'Se testează…' : 'Test conexiune'}
				</button>
				<button class="cc-btn danger" onclick={remove} disabled={deleting}>
					<TrashIcon class="h-4 w-4" />
					{deleting ? 'Se șterge…' : 'Șterge'}
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	/* ===== Claude Design (cl-*) — scopat local pentru pagina de settings ===== */
	.claude-cfg {
		--cl-surface: #ffffff;
		--cl-surface-2: #fafbfd;
		--cl-border: #e8ecf2;
		--cl-border-strong: #d5dbe5;
		--cl-text: #0f172a;
		--cl-text-2: #475569;
		--cl-text-3: #94a3b8;
		--cl-accent: #1877f2;
		--cl-accent-600: #0d5cc7;
		--cl-accent-50: #e7f0fe;
		--cl-plan: #7c3aed;
		--cl-plan-50: #f3ecff;
		--cl-success: #10b981;
		--cl-success-50: #ecfdf5;
		--cl-warn: #b45309;
		--cl-warn-50: #fffbeb;
		--cl-danger: #ef4444;
		--cl-danger-50: #fef2f2;

		font-family: 'Inter', system-ui, sans-serif;
		color: var(--cl-text);
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 760px;
	}

	:global(.dark) .claude-cfg {
		--cl-surface: #111827;
		--cl-surface-2: #0f1626;
		--cl-border: #1f2a3b;
		--cl-border-strong: #334155;
		--cl-text: #e5e7eb;
		--cl-text-2: #a3b1c6;
		--cl-text-3: #6b7a90;
		--cl-accent: #3b8bf5;
		--cl-accent-600: #1877f2;
		--cl-accent-50: rgba(59, 139, 245, 0.16);
		--cl-plan: #a78bfa;
		--cl-plan-50: rgba(124, 58, 237, 0.16);
		--cl-success: #34d399;
		--cl-success-50: rgba(16, 185, 129, 0.14);
		--cl-warn: #fbbf24;
		--cl-warn-50: rgba(245, 158, 11, 0.14);
		--cl-danger: #f2534f;
		--cl-danger-50: rgba(242, 83, 79, 0.14);
	}

	/* Header */
	.cc-head {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.cc-head-ic {
		width: 40px;
		height: 40px;
		border-radius: 11px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		background: linear-gradient(135deg, var(--cl-plan), var(--cl-accent));
		color: #fff;
	}
	.cc-head h2 {
		margin: 0;
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.cc-head p {
		margin: 3px 0 0;
		font-size: 13px;
		color: var(--cl-text-2);
		line-height: 1.5;
	}

	/* Status */
	.cc-status {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 12px;
		background: var(--cl-success-50);
		border: 1px solid color-mix(in srgb, var(--cl-success) 30%, transparent);
		border-radius: 12px;
		padding: 12px 16px;
	}
	.cc-badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #047857;
		background: var(--cl-surface);
		border-radius: 999px;
		padding: 3px 10px;
	}
	:global(.dark) .cc-badge {
		color: #34d399;
	}
	.cc-status-key {
		font-size: 13px;
		font-weight: 600;
		color: var(--cl-text);
	}
	.cc-status-tested {
		font-size: 11.5px;
		color: var(--cl-text-3);
		margin-left: auto;
	}
	.cc-alert {
		flex-basis: 100%;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 12.5px;
		color: var(--cl-warn);
		background: var(--cl-warn-50);
		border-radius: 8px;
		padding: 8px 10px;
	}

	/* Two modes */
	.cc-modes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	@media (max-width: 640px) {
		.cc-modes {
			grid-template-columns: 1fr;
		}
	}
	.cc-mode {
		background: var(--cl-surface);
		border: 1px solid var(--cl-border);
		border-radius: 12px;
		padding: 14px 16px;
		transition:
			border-color 0.14s,
			box-shadow 0.14s,
			transform 0.14s;
	}
	.cc-mode.sel {
		border-color: var(--cl-accent);
		box-shadow: 0 0 0 3px var(--cl-accent-50);
	}
	.cc-mode:nth-child(2).sel {
		border-color: var(--cl-plan);
		box-shadow: 0 0 0 3px var(--cl-plan-50);
	}
	.cc-mode-top {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 9px;
	}
	.cc-mode-ic {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.cc-mode-ic.api {
		background: var(--cl-accent-50);
		color: var(--cl-accent);
	}
	.cc-mode-ic.plan {
		background: var(--cl-plan-50);
		color: var(--cl-plan);
	}
	.cc-mode-title {
		font-size: 13.5px;
		font-weight: 700;
	}
	.cc-mode-tag {
		font-size: 9.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--cl-plan);
		background: var(--cl-plan-50);
		border-radius: 999px;
		padding: 2px 7px;
	}
	.cc-code {
		display: inline-block;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 12px;
		color: var(--cl-text);
		background: var(--cl-surface-2);
		border: 1px solid var(--cl-border);
		border-radius: 6px;
		padding: 2px 8px;
	}
	.cc-mode-desc {
		margin: 9px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--cl-text-2);
	}
	.cc-mode-desc strong {
		color: var(--cl-text);
		font-weight: 600;
	}
	.cc-kbd {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 11px;
		color: var(--cl-text);
		background: var(--cl-surface-2);
		border: 1px solid var(--cl-border-strong);
		border-bottom-width: 2px;
		border-radius: 6px;
		padding: 1px 6px;
		white-space: nowrap;
	}

	/* Form */
	.cc-form {
		background: var(--cl-surface);
		border: 1px solid var(--cl-border);
		border-radius: 12px;
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.cc-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cc-field label {
		font-size: 12px;
		font-weight: 600;
		color: var(--cl-text);
	}
	.cc-field input,
	.cc-select {
		width: 100%;
		border: 1px solid var(--cl-border);
		background: var(--cl-surface);
		border-radius: 9px;
		padding: 9px 12px;
		font: inherit;
		font-size: 13px;
		color: var(--cl-text);
		outline: 0;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.cc-field input {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
	.cc-field input:focus,
	.cc-select:focus {
		border-color: var(--cl-accent);
		box-shadow: 0 0 0 3px var(--cl-accent-50);
	}
	.cc-field input:disabled,
	.cc-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.cc-select {
		appearance: none;
		cursor: pointer;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
		padding-right: 34px;
	}
	.cc-hint {
		margin: 0;
		font-size: 11.5px;
		color: var(--cl-text-3);
	}
	.cc-detect {
		margin: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
	}
	.cc-detect.plan {
		color: var(--cl-plan);
	}
	.cc-detect.api {
		color: var(--cl-accent);
	}
	.cc-detect.warn {
		color: var(--cl-warn);
	}
	.cc-detect code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
	.cc-detect strong {
		font-weight: 700;
	}

	/* Actions */
	.cc-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding-top: 2px;
	}
	.cc-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 9px 15px;
		border-radius: 9px;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		border: 1px solid transparent;
		transition: all 0.12s;
	}
	.cc-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.cc-btn.primary {
		background: var(--cl-accent);
		color: #fff;
	}
	.cc-btn.primary:not(:disabled):hover {
		background: var(--cl-accent-600);
	}
	.cc-btn.ghost {
		background: var(--cl-surface);
		color: var(--cl-text-2);
		border-color: var(--cl-border);
	}
	.cc-btn.ghost:not(:disabled):hover {
		border-color: var(--cl-border-strong);
		color: var(--cl-text);
	}
	.cc-btn.danger {
		background: var(--cl-surface);
		color: var(--cl-danger);
		border-color: color-mix(in srgb, var(--cl-danger) 35%, transparent);
	}
	.cc-btn.danger:not(:disabled):hover {
		background: var(--cl-danger-50);
	}
	.cc-tico {
		display: inline-flex;
	}
	.cc-spin {
		animation: cc-spin 0.8s linear infinite;
	}
	@keyframes cc-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
