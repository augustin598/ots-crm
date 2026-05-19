<script lang="ts">
	import { addDAServer } from '$lib/remotes/da-servers.remote';
	import { toast } from 'svelte-sonner';
	import ServerIcon from '@lucide/svelte/icons/server';
	import XIcon from '@lucide/svelte/icons/x';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import CheckIcon from '@lucide/svelte/icons/check';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { focusTrap } from '$lib/actions/focus-trap';

	type Props = {
		onClose: () => void;
		onAdded: (name: string, online: boolean) => void | Promise<void>;
	};
	let { onClose, onAdded }: Props = $props();

	let draft = $state({
		name: '',
		hostname: '',
		port: '2222',
		protocol: 'https' as 'http' | 'https',
		user: '',
		password: ''
	});
	let showPwd = $state(false);
	let submitting = $state(false);
	let testResult = $state<'ok' | 'fail' | null>(null);
	let errorMessage = $state<string | null>(null);

	// Live mirror of the server-side `parseHostname` so the user sees the URL
	// the API will actually use (stripping any pasted protocol/port/path).
	const parsed = $derived.by(() => {
		let s = draft.hostname.trim();
		let detectedProto: 'http' | 'https' | null = null;
		if (s.startsWith('https://')) {
			detectedProto = 'https';
			s = s.slice(8);
		} else if (s.startsWith('http://')) {
			detectedProto = 'http';
			s = s.slice(7);
		}
		s = s.replace(/\/+$/, '').split('/')[0];
		const m = s.match(/^([^:]+)(?::(\d+))?$/);
		const host = m ? m[1] : s;
		const detectedPort = m && m[2] ? parseInt(m[2], 10) : null;
		const portFromField = parseInt(draft.port || '0', 10) || 2222;
		return {
			host,
			port: detectedPort ?? portFromField,
			useHttps:
				detectedProto === 'http'
					? false
					: detectedProto === 'https'
						? true
						: draft.protocol === 'https',
			detectedProto,
			detectedPort
		};
	});

	const effectiveUrl = $derived(
		`${parsed.useHttps ? 'https' : 'http'}://${parsed.host || '<hostname>'}:${parsed.port}`
	);

	const canSubmit = $derived(
		draft.name.trim() !== '' &&
			draft.hostname.trim() !== '' &&
			draft.user.trim() !== '' &&
			draft.password.trim() !== '' &&
			!submitting
	);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!canSubmit) return;
		submitting = true;
		testResult = null;
		errorMessage = null;
		try {
			const result = await addDAServer({
				name: draft.name.trim(),
				hostname: draft.hostname.trim(),
				port: parseInt(draft.port || '2222', 10) || 2222,
				useHttps: draft.protocol === 'https',
				username: draft.user.trim(),
				password: draft.password
			});
			testResult = result.online ? 'ok' : 'fail';
			if (!result.online && 'error' in result && result.error) {
				errorMessage = result.error;
			}
			// Brief delay so user sees the banner, then notify parent.
			setTimeout(() => onAdded(draft.name.trim(), result.online), 600);
		} catch (err) {
			testResult = 'fail';
			errorMessage = err instanceof Error ? err.message : String(err);
			toast.error(errorMessage);
		} finally {
			submitting = false;
		}
	}

	function setPortDigitsOnly(v: string) {
		draft.port = v.replace(/[^\d]/g, '');
	}
</script>

<div
	class="ha-modal-back"
	role="dialog"
	aria-modal="true"
	aria-labelledby="new-srv-title"
	tabindex={-1}
	onclick={onClose}
	onkeydown={() => {
		/* focusTrap handles Escape */
	}}
	use:focusTrap={{ active: true, onEscape: onClose, initialFocus: '#srv-name' }}
>
<div
	class="ha-modal lg"
	role="none"
	onclick={(e) => e.stopPropagation()}
	onkeydown={() => {}}
>
	<div class="ha-modal-head">
		<div class="ha-modal-icon"><ServerIcon size={18} /></div>
		<div style="flex:1; min-width:0">
			<div class="ha-modal-title" id="new-srv-title">Server nou</div>
			<div class="ha-modal-sub">
				Conectează un server DirectAdmin folosind un cont admin sau reseller cu API access activ.
			</div>
		</div>
		<button class="ha-modal-close" onclick={onClose} aria-label="Închide">
			<XIcon size={14} />
		</button>
	</div>

	<form onsubmit={handleSubmit}>
		<div class="ha-modal-body">
			<div class="ha-grid">
				<div class="ha-section">
					<label class="ha-label" for="srv-name">
						Nume intern <span class="req">*</span>
					</label>
					<input
						id="srv-name"
						class="ha-input"
						placeholder="ex: Server Principal București"
						bind:value={draft.name}
					/>
					<div class="ha-hint">
						Un nume prietenos doar pentru tine (apare în listă și meniuri). NU URL-ul serverului.
					</div>
				</div>

				<div class="ha-section">
					<label class="ha-label" for="srv-host">
						Hostname / IP <span class="req">*</span>
					</label>
					<input
						id="srv-host"
						class="ha-input mono"
						placeholder="ex: 46.4.159.108 sau da.onetopsolution.ro"
						bind:value={draft.hostname}
					/>
					<div class="ha-hint">
						Adresa la care răspunde DirectAdmin — IP public sau subdomeniu. Fără
						<code>https://</code> și fără port.
					</div>
				</div>

				<div class="ha-section">
					<label class="ha-label" for="srv-port">Port</label>
					<input
						id="srv-port"
						class="ha-input mono"
						placeholder="2222"
						value={draft.port}
						oninput={(e) => setPortDigitsOnly((e.currentTarget as HTMLInputElement).value)}
					/>
					<div class="ha-hint">Implicit DirectAdmin: <code>2222</code>.</div>
				</div>

				<div class="ha-section">
					<span class="ha-label">Protocol</span>
					<div class="ha-radio-row">
						{#each [{ v: 'https' as const, l: 'HTTPS' }, { v: 'http' as const, l: 'HTTP' }] as opt (opt.v)}
							<label class="ha-radio" class:active={draft.protocol === opt.v}>
								<input
									type="radio"
									name="protocol"
									value={opt.v}
									bind:group={draft.protocol}
								/>
								{opt.l}
							</label>
						{/each}
					</div>
					<div class="ha-hint">
						Implicit <strong>HTTPS</strong>. Alege HTTP doar dacă serverul tău nu are TLS pe portul
						DA (servere legacy).
					</div>
				</div>

				<div class="ha-section">
					<label class="ha-label" for="srv-user">
						Utilizator admin <span class="req">*</span>
					</label>
					<input
						id="srv-user"
						class="ha-input mono"
						placeholder="ex: admin"
						autocomplete="off"
						bind:value={draft.user}
					/>
					<div class="ha-hint">
						Username-ul contului de <strong>admin</strong> sau <strong>reseller</strong> DA. Acest user
						va crea conturile noi. Recomandat: un user dedicat cu API enabled.
					</div>
				</div>

				<div class="ha-section">
					<label class="ha-label" for="srv-pwd">
						Parolă <span class="req">*</span>
					</label>
					<div class="ha-input-wrap">
						<input
							id="srv-pwd"
							class="ha-input"
							type={showPwd ? 'text' : 'password'}
							autocomplete="new-password"
							bind:value={draft.password}
						/>
						<button
							type="button"
							class="ha-input-action"
							onclick={() => (showPwd = !showPwd)}
							aria-label={showPwd ? 'Ascunde parola' : 'Arată parola'}
						>
							{#if showPwd}
								<EyeOffIcon size={14} />
							{:else}
								<EyeIcon size={14} />
							{/if}
						</button>
					</div>
					<div class="ha-hint">
						Parola contului de mai sus, SAU un <strong>login key</strong> generat din DA cu permisiuni
						API. Va fi criptată AES-256-GCM înainte de salvare.
					</div>
				</div>
			</div>

			<div class="ha-effective-url">
				<GlobeIcon size={14} />
				<span>
					URL efectiv folosit:
					<code>{effectiveUrl}</code>
				</span>
				{#if parsed.detectedProto || parsed.detectedPort}
					<span class="ha-detect-warn">
						⚠ Am detectat
						{#if parsed.detectedProto}protocolul <strong>{parsed.detectedProto}</strong>{/if}
						{#if parsed.detectedProto && parsed.detectedPort} și {/if}
						{#if parsed.detectedPort}portul <strong>{parsed.detectedPort}</strong>{/if}
						în câmpul Hostname. Le voi extrage automat — Hostname va fi salvat curat ca
						<code>{parsed.host}</code>.
					</span>
				{/if}
			</div>

			{#if testResult === 'ok'}
				<div class="ha-alert success">
					<CheckIcon size={14} />
					<span>Conexiune validă · API răspunde · server adăugat.</span>
				</div>
			{:else if testResult === 'fail'}
				<div class="ha-alert danger">
					<AlertTriangleIcon size={14} />
					<span>
						Serverul a fost salvat, dar conexiunea a eșuat. {errorMessage ??
							'Verifică hostname, port și credențiale.'}
					</span>
				</div>
			{/if}
		</div>

		<div class="ha-modal-foot">
			<button type="submit" class="btn-primary" disabled={!canSubmit}>
				{#if submitting}
					<RefreshCwIcon class="hst-modal-spin" size={13} /> Se testează…
				{:else}
					<PlusIcon size={13} /> Adaugă & testează conexiunea
				{/if}
			</button>
			<button type="button" class="btn-secondary" onclick={onClose}>Anulează</button>
		</div>
	</form>
</div>
</div>

<style>
	.ha-modal-back {
		position: fixed;
		inset: 0;
		z-index: 89;
		background: rgba(15, 23, 42, 0.45);
		backdrop-filter: blur(3px);
		animation: fadeIn 0.15s;
		border: none;
		padding: 0;
		cursor: default;
	}
	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.ha-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 880px;
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
		font-family:
			'Inter',
			system-ui,
			-apple-system,
			sans-serif;
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
	.ha-modal form {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.ha-modal-head {
		padding: 18px 22px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}
	.ha-modal-icon {
		width: 36px;
		height: 36px;
		border-radius: 9px;
		background: linear-gradient(135deg, #1877f2, #0d5cc7);
		color: white;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.ha-modal-title {
		font-size: 16px;
		font-weight: 700;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.ha-modal-sub {
		font-size: 12px;
		color: #94a3b8;
		margin-top: 2px;
	}
	.ha-modal-close {
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
	.ha-modal-close:hover {
		background: #f4f6fa;
		color: #0f172a;
	}

	.ha-modal-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px 22px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.ha-modal-foot {
		padding: 14px 22px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		gap: 10px;
		align-items: center;
		background: #fafbfd;
		flex-shrink: 0;
	}

	.ha-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		column-gap: 28px;
		row-gap: 22px;
		align-items: start;
	}
	.ha-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ha-label {
		font-size: 11.5px;
		font-weight: 700;
		color: #0f172a;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.req {
		color: #ef4444;
	}
	.ha-hint {
		font-size: 11px;
		color: #94a3b8;
		line-height: 1.5;
	}
	.ha-hint strong {
		color: #475569;
	}
	.ha-hint code {
		background: #f1f5f9;
		padding: 1px 4px;
		border-radius: 3px;
		font-size: 11px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}

	.ha-input {
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
		box-sizing: border-box;
	}
	.ha-input:focus {
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.ha-input::placeholder {
		color: #cbd5e1;
	}
	.ha-input.mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}

	.ha-input-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}
	.ha-input-wrap .ha-input {
		padding-right: 40px;
	}
	.ha-input-action {
		background: transparent;
		border: none;
		color: #94a3b8;
		cursor: pointer;
		width: 28px;
		height: 28px;
		border-radius: 5px;
		display: grid;
		place-items: center;
		position: absolute;
		right: 4px;
	}
	.ha-input-action:hover {
		background: #f4f6fa;
		color: #1877f2;
	}

	.ha-radio-row {
		display: flex;
		gap: 10px;
	}
	.ha-radio {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		background: white;
		border: 1px solid #d5dbe5;
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
		font-weight: 600;
		color: #0f172a;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.ha-radio.active {
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.ha-radio input[type='radio'] {
		width: 14px;
		height: 14px;
		accent-color: #1877f2;
		margin: 0;
	}

	.ha-effective-url {
		background: #eff6ff;
		border: 1px solid #bfdbfe;
		border-radius: 10px;
		padding: 12px 14px;
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12.5px;
		color: #1e3a8a;
		flex-wrap: wrap;
	}
	.ha-effective-url code {
		background: rgba(255, 255, 255, 0.7);
		padding: 2px 6px;
		border-radius: 4px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 12px;
		color: #0f172a;
	}
	.ha-detect-warn {
		font-size: 11.5px;
		color: #b45309;
		width: 100%;
		margin-top: 4px;
		line-height: 1.5;
	}
	.ha-detect-warn code {
		background: rgba(245, 158, 11, 0.12);
		color: #b45309;
	}

	.ha-alert {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		border-radius: 10px;
		font-size: 12.5px;
	}
	.ha-alert.success {
		background: rgba(16, 185, 129, 0.08);
		border: 1px solid rgba(16, 185, 129, 0.3);
		color: #047857;
	}
	.ha-alert.danger {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #b91c1c;
	}

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

	:global(.hst-modal-spin) {
		animation: hst-spin 0.8s linear infinite;
	}
	@keyframes hst-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 760px) {
		.ha-modal {
			width: calc(100vw - 24px);
		}
		.ha-grid {
			grid-template-columns: 1fr;
			row-gap: 14px;
		}
	}
</style>
