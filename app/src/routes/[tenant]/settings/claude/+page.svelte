<!-- src/routes/[tenant]/settings/claude/+page.svelte -->
<script lang="ts">
	import {
		getClaudeIntegration,
		saveClaudeKey,
		deleteClaudeKey,
		setClaudeRoute,
		testClaudeConnection
	} from '$lib/remotes/claude-integration.remote';
	import { CLAUDE_MODELS } from '$lib/claude-models';
	import { CLAUDE_USE_CASES, type ClaudeUseCaseId } from '$lib/claude-usecases';
	import { toast } from 'svelte-sonner';
	import KeyIcon from '@lucide/svelte/icons/key';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import TerminalIcon from '@lucide/svelte/icons/terminal';

	type KeyType = 'api' | 'oat';

	const integrationQuery = getClaudeIntegration();
	const current = $derived(integrationQuery.current ?? null);
	const loading = $derived(integrationQuery.loading);

	let pasteKey = $state('');
	let saving = $state(false);
	let testing = $state<KeyType | null>(null);
	let deleting = $state<KeyType | null>(null);
	let routing = $state<string | null>(null); // useCaseId în curs de salvare

	const keyPreview = $derived(
		!pasteKey.trim()
			? null
			: pasteKey.trim().startsWith('sk-ant-oat')
				? 'oat'
				: pasteKey.trim().startsWith('sk-ant-')
					? 'api'
					: 'unknown'
	);

	async function save() {
		saving = true;
		try {
			const r = await saveClaudeKey({ apiKey: pasteKey.trim() }).updates(integrationQuery);
			toast.success(
				r.slot === 'oat' ? 'Token Abonament (OAuth) salvat.' : 'Cheie API salvată.'
			);
			pasteKey = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}

	async function test(keyType: KeyType) {
		testing = keyType;
		try {
			const r = await testClaudeConnection({ keyType }).updates(integrationQuery);
			toast.success(
				r.via === 'models'
					? `OK — ${keyType === 'oat' ? 'Abonament' : 'API'} valid (${r.models.length} modele).`
					: `OK — ${keyType === 'oat' ? 'Abonament' : 'API'} valid.`
			);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Test eșuat');
		} finally {
			testing = null;
		}
	}

	async function del(keyType: KeyType) {
		if (!confirm(`Sigur ștergi cheia ${keyType === 'oat' ? 'Abonament (OAuth)' : 'API'}?`)) return;
		deleting = keyType;
		try {
			await deleteClaudeKey({ keyType }).updates(integrationQuery);
			toast.success('Cheie ștearsă.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			deleting = null;
		}
	}

	async function setRoute(useCaseId: ClaudeUseCaseId, keyType: KeyType, model: string) {
		routing = useCaseId;
		try {
			await setClaudeRoute({ useCaseId, keyType, model }).updates(integrationQuery);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la rutare');
		} finally {
			routing = null;
		}
	}
</script>

<div class="claude-cfg">
	<header class="cc-head">
		<div class="cc-head-ic"><SparklesIcon class="h-5 w-5" /></div>
		<div>
			<h2>Claude</h2>
			<p>
				Conectează una sau ambele credențiale, apoi rutează fiecare utilizare AI pe cheia + modelul
				dorit. Cheile sunt criptate per-tenant și nu părăsesc serverul.
			</p>
		</div>
	</header>

	<!-- Cele două sloturi de credențiale -->
	<div class="cc-slots">
		<!-- API key -->
		<div class="cc-slot" class:on={current?.api.connected}>
			<div class="cc-slot-top">
				<span class="cc-slot-ic api"><KeyIcon class="h-4 w-4" /></span>
				<span class="cc-slot-title">API key</span>
				{#if current?.api.connected}
					<span class="cc-pill ok"><CheckCircleIcon class="h-3 w-3" /> …{current.api.hint}</span>
				{:else}
					<span class="cc-pill off"><CircleIcon class="h-3 w-3" /> neconectat</span>
				{/if}
			</div>
			<p class="cc-slot-desc">
				<code class="cc-code">sk-ant-api03-…</code> · console.anthropic.com · consumă credite API
			</p>
			{#if current?.api.connected}
				<div class="cc-slot-actions">
					<button class="cc-btn ghost sm" onclick={() => test('api')} disabled={testing === 'api'}>
						<span class="cc-tico" class:cc-spin={testing === 'api'}><RefreshIcon class="h-3.5 w-3.5" /></span>
						Test
					</button>
					<button class="cc-btn danger sm" onclick={() => del('api')} disabled={deleting === 'api'}>
						<TrashIcon class="h-3.5 w-3.5" /> Șterge
					</button>
				</div>
			{/if}
		</div>

		<!-- Abonament (OAuth) -->
		<div class="cc-slot" class:on={current?.oat.connected}>
			<div class="cc-slot-top">
				<span class="cc-slot-ic plan"><SparklesIcon class="h-4 w-4" /></span>
				<span class="cc-slot-title">Abonament (OAuth)</span>
				{#if current?.oat.connected}
					<span class="cc-pill ok"><CheckCircleIcon class="h-3 w-3" /> …{current.oat.hint}</span>
				{:else}
					<span class="cc-pill off"><CircleIcon class="h-3 w-3" /> neconectat</span>
				{/if}
			</div>
			<p class="cc-slot-desc">
				<code class="cc-code">sk-ant-oat01-…</code> · <span class="cc-kbd"
					><TerminalIcon class="h-3 w-3" /> claude setup-token</span
				> · abonamentul Pro/Max
			</p>
			{#if current?.oat.connected}
				<div class="cc-slot-actions">
					<button class="cc-btn ghost sm" onclick={() => test('oat')} disabled={testing === 'oat'}>
						<span class="cc-tico" class:cc-spin={testing === 'oat'}><RefreshIcon class="h-3.5 w-3.5" /></span>
						Test
					</button>
					<button class="cc-btn danger sm" onclick={() => del('oat')} disabled={deleting === 'oat'}>
						<TrashIcon class="h-3.5 w-3.5" /> Șterge
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Adaugă / actualizează o cheie -->
	<div class="cc-form">
		<div class="cc-field">
			<label for="claude-key">Adaugă sau actualizează o cheie</label>
			<div class="cc-key-row">
				<input
					id="claude-key"
					type="password"
					bind:value={pasteKey}
					placeholder="sk-ant-api03-…  sau  sk-ant-oat01-…"
					autocomplete="off"
					spellcheck="false"
					disabled={loading}
				/>
				<button class="cc-btn primary" onclick={save} disabled={saving || loading || !pasteKey.trim()}>
					<KeyIcon class="h-4 w-4" />
					{saving ? 'Se salvează…' : 'Salvează'}
				</button>
			</div>
			{#if keyPreview === 'oat'}
				<p class="cc-detect plan">
					<SparklesIcon class="h-3.5 w-3.5" /> Token OAuth → se salvează în slotul <strong>Abonament</strong>
				</p>
			{:else if keyPreview === 'api'}
				<p class="cc-detect api">
					<KeyIcon class="h-3.5 w-3.5" /> API key → se salvează în slotul <strong>API</strong>
				</p>
			{:else if keyPreview === 'unknown'}
				<p class="cc-detect warn">
					<AlertCircleIcon class="h-3.5 w-3.5" /> Cheia trebuie să înceapă cu <code>sk-ant-…</code>
				</p>
			{:else}
				<p class="cc-hint">Se detectează automat după prefix și se salvează în slotul potrivit.</p>
			{/if}
		</div>
	</div>

	<!-- Rutare pe utilizări -->
	<div class="cc-route">
		<div class="cc-route-head">
			<h3>Rutare pe utilizări</h3>
			<p>Pentru fiecare utilizare AI alege ce cheie + ce model folosește.</p>
		</div>

		{#if current}
			<div class="cc-route-list">
				{#each CLAUDE_USE_CASES as uc (uc.id)}
					{@const route = current.routes[uc.id]}
					<div class="cc-route-row" class:busy={routing === uc.id}>
						<div class="cc-route-name">
							<span class="cc-route-label">{uc.label}</span>
							<span class="cc-route-hint">{uc.hint}</span>
						</div>

						<div class="cc-seg" role="group" aria-label="Cheie pentru {uc.label}">
							<button
								class="cc-seg-btn"
								class:on={route.keyType === 'api'}
								disabled={!current.api.connected || routing === uc.id}
								title={current.api.connected ? 'Folosește cheia API' : 'Adaugă o cheie API întâi'}
								onclick={() => setRoute(uc.id, 'api', route.model)}
							>
								<KeyIcon class="h-3.5 w-3.5" /> API
							</button>
							<button
								class="cc-seg-btn"
								class:on={route.keyType === 'oat'}
								disabled={!current.oat.connected || routing === uc.id}
								title={current.oat.connected ? 'Folosește Abonamentul' : 'Adaugă token-ul Abonament întâi'}
								onclick={() => setRoute(uc.id, 'oat', route.model)}
							>
								<SparklesIcon class="h-3.5 w-3.5" /> Abonament
							</button>
						</div>

						<select
							class="cc-select cc-route-model"
							value={route.model}
							disabled={routing === uc.id}
							onchange={(e) => setRoute(uc.id, route.keyType, e.currentTarget.value)}
						>
							{#each CLAUDE_MODELS as m (m.id)}
								<option value={m.id}>{m.label}</option>
							{/each}
						</select>
					</div>
				{/each}
			</div>
			{#if !current.api.connected || !current.oat.connected}
				<p class="cc-route-note">
					<AlertCircleIcon class="h-3.5 w-3.5" />
					{#if !current.api.connected && !current.oat.connected}
						Adaugă cel puțin o cheie ca să poți ruta utilizările.
					{:else if !current.api.connected}
						Slotul API e gol — opțiunea „API" e dezactivată până adaugi o cheie API.
					{:else}
						Slotul Abonament e gol — opțiunea „Abonament" e dezactivată până adaugi token-ul OAuth.
					{/if}
				</p>
			{/if}
		{:else}
			<p class="cc-hint">Se încarcă…</p>
		{/if}
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
		width: 100%;
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

	/* Two credential slots */
	.cc-slots {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	@media (max-width: 640px) {
		.cc-slots {
			grid-template-columns: 1fr;
		}
	}
	.cc-slot {
		background: var(--cl-surface);
		border: 1px solid var(--cl-border);
		border-radius: 12px;
		padding: 14px 16px;
	}
	.cc-slot.on {
		border-color: color-mix(in srgb, var(--cl-success) 40%, var(--cl-border));
		background: linear-gradient(0deg, var(--cl-success-50), transparent 60%), var(--cl-surface);
	}
	.cc-slot-top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cc-slot-ic {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.cc-slot-ic.api {
		background: var(--cl-accent-50);
		color: var(--cl-accent);
	}
	.cc-slot-ic.plan {
		background: var(--cl-plan-50);
		color: var(--cl-plan);
	}
	.cc-slot-title {
		font-size: 13.5px;
		font-weight: 700;
	}
	.cc-pill {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		font-weight: 700;
		border-radius: 999px;
		padding: 3px 9px;
	}
	.cc-pill.ok {
		color: #047857;
		background: var(--cl-success-50);
	}
	:global(.dark) .cc-pill.ok {
		color: #34d399;
	}
	.cc-pill.off {
		color: var(--cl-text-3);
		background: var(--cl-surface-2);
	}
	.cc-slot-desc {
		margin: 9px 0 0;
		font-size: 11.5px;
		line-height: 1.6;
		color: var(--cl-text-2);
	}
	.cc-slot-actions {
		margin-top: 11px;
		display: flex;
		gap: 7px;
	}

	.cc-code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 11px;
		color: var(--cl-text);
		background: var(--cl-surface-2);
		border: 1px solid var(--cl-border);
		border-radius: 5px;
		padding: 1px 6px;
	}
	.cc-kbd {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 10.5px;
		color: var(--cl-text);
		background: var(--cl-surface-2);
		border: 1px solid var(--cl-border-strong);
		border-bottom-width: 2px;
		border-radius: 5px;
		padding: 0 5px;
		white-space: nowrap;
	}

	/* Add key form */
	.cc-form {
		background: var(--cl-surface);
		border: 1px solid var(--cl-border);
		border-radius: 12px;
		padding: 16px 18px;
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
	.cc-key-row {
		display: flex;
		gap: 8px;
	}
	.cc-key-row input {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--cl-border);
		background: var(--cl-surface);
		border-radius: 9px;
		padding: 9px 12px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 13px;
		color: var(--cl-text);
		outline: 0;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.cc-key-row input:focus {
		border-color: var(--cl-accent);
		box-shadow: 0 0 0 3px var(--cl-accent-50);
	}
	.cc-key-row input:disabled {
		opacity: 0.6;
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

	/* Select (shared) */
	.cc-select {
		border: 1px solid var(--cl-border);
		background: var(--cl-surface);
		border-radius: 9px;
		padding: 8px 32px 8px 11px;
		font: inherit;
		font-size: 12.5px;
		color: var(--cl-text);
		outline: 0;
		appearance: none;
		cursor: pointer;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 11px center;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.cc-select:focus {
		border-color: var(--cl-accent);
		box-shadow: 0 0 0 3px var(--cl-accent-50);
	}
	.cc-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Routing table */
	.cc-route {
		background: var(--cl-surface);
		border: 1px solid var(--cl-border);
		border-radius: 12px;
		padding: 16px 18px;
	}
	.cc-route-head h3 {
		margin: 0;
		font-size: 14.5px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.cc-route-head p {
		margin: 3px 0 14px;
		font-size: 12px;
		color: var(--cl-text-2);
	}
	.cc-route-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.cc-route-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		gap: 12px;
		padding: 9px 11px;
		border: 1px solid var(--cl-border);
		border-radius: 10px;
		background: var(--cl-surface-2);
		transition: opacity 0.12s;
	}
	.cc-route-row.busy {
		opacity: 0.55;
	}
	@media (max-width: 640px) {
		.cc-route-row {
			grid-template-columns: 1fr;
			gap: 9px;
		}
	}
	.cc-route-name {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.cc-route-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--cl-text);
	}
	.cc-route-hint {
		font-size: 11px;
		color: var(--cl-text-3);
	}
	.cc-route-model {
		min-width: 128px;
	}

	/* Segmented switch */
	.cc-seg {
		display: inline-flex;
		background: var(--cl-surface);
		border: 1px solid var(--cl-border);
		border-radius: 8px;
		padding: 2px;
		gap: 2px;
	}
	.cc-seg-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 0;
		background: transparent;
		border-radius: 6px;
		padding: 5px 10px;
		font-family: inherit;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--cl-text-2);
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 0.12s,
			color 0.12s;
	}
	.cc-seg-btn:not(:disabled):hover {
		color: var(--cl-text);
	}
	.cc-seg-btn.on {
		background: var(--cl-accent);
		color: #fff;
	}
	.cc-seg-btn.on:nth-child(2) {
		background: var(--cl-plan);
	}
	.cc-seg-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.cc-route-note {
		margin: 12px 0 0;
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--cl-warn);
		background: var(--cl-warn-50);
		border-radius: 8px;
		padding: 8px 11px;
	}

	/* Buttons */
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
	.cc-btn.sm {
		padding: 6px 11px;
		font-size: 11.5px;
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
