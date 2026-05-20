<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { createDAPackage, updateDAPackage } from '$lib/remotes/da-servers.remote';
	import { focusTrap } from '$lib/actions/focus-trap';
	import PackageIcon from '@lucide/svelte/icons/package';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	type PackageInput = {
		bandwidth: number | null;
		quota: number | null;
		maxInodes: number | null;
		maxDomains: number | null;
		maxSubdomains: number | null;
		maxDomainPointers: number | null;
		maxEmailAccounts: number | null;
		maxEmailForwarders: number | null;
		maxMailingLists: number | null;
		maxAutoresponders: number | null;
		maxDatabases: number | null;
		maxFtpAccounts: number | null;
		emailDailyLimit: number | null;
		anonymousFtp: boolean;
		cgi: boolean;
		php: boolean;
		ssl: boolean;
		ssh: boolean;
		dnsControl: boolean;
		cron: boolean;
		spam: boolean;
		clamav: boolean;
		wordpress: boolean;
		git: boolean;
		redis: boolean;
		suspendAtLimit: boolean;
		oversold: boolean;
		jailed: boolean;
		securityTxt: boolean;
		cpuQuota: number | null;
		ioReadBandwidthMax: number | null;
		iopsReadMax: number | null;
		ioWriteBandwidthMax: number | null;
		iopsWriteMax: number | null;
		memoryHigh: number | null;
		memoryMax: number | null;
		tasksMax: number | null;
		skin: string | null;
		language: string | null;
		featureSetsPolicy: 'allow_all_commands' | 'allow_selected_features';
		featureSetsSelected: string[];
		pluginsPolicy: 'allow_all' | 'deny_selected' | 'allow_selected';
		pluginsSelected: string[];
	};

	type Props = {
		mode: 'new' | 'edit';
		daServerId: string;
		/** Existing package id when mode='edit'. */
		packageId?: string | null;
		/** Existing daName (without tenant prefix) when mode='edit'. */
		existingDaName?: string | null;
		/** Pre-filled state when mode='edit'. */
		initial?: Partial<PackageInput>;
		onClose: () => void;
		/** Called with the daPackage row id after a successful create/edit. */
		onSaved: (newPackageId: string) => void | Promise<void>;
	};

	let { mode, daServerId, packageId = null, existingDaName = null, initial, onClose, onSaved }: Props =
		$props();

	const tenantSlug = $derived(page.params.tenant);

	function defaultInput(): PackageInput {
		return {
			bandwidth: null,
			quota: null,
			maxInodes: null,
			maxDomains: null,
			maxSubdomains: null,
			maxDomainPointers: null,
			maxEmailAccounts: null,
			maxEmailForwarders: null,
			maxMailingLists: null,
			maxAutoresponders: null,
			maxDatabases: null,
			maxFtpAccounts: null,
			emailDailyLimit: null,
			anonymousFtp: false,
			cgi: false,
			php: true,
			ssl: true,
			ssh: false,
			dnsControl: true,
			cron: true,
			spam: true,
			clamav: false,
			wordpress: true,
			git: false,
			redis: false,
			suspendAtLimit: true,
			oversold: false,
			jailed: true,
			securityTxt: false,
			cpuQuota: null,
			ioReadBandwidthMax: null,
			iopsReadMax: null,
			ioWriteBandwidthMax: null,
			iopsWriteMax: null,
			memoryHigh: null,
			memoryMax: null,
			tasksMax: null,
			skin: 'evolution',
			language: 'en',
			featureSetsPolicy: 'allow_all_commands',
			featureSetsSelected: [],
			pluginsPolicy: 'allow_all',
			pluginsSelected: []
		};
	}

	// Name suffix typed by admin. For edit, derive from existingDaName (strip `{slug}-` prefix).
	// Both nameSuffix and opts are initialised lazily so the prop references aren't
	// `state_referenced_locally` warnings — the component is instantiated fresh on
	// every "open" and we never want it to re-sync from props mid-life.
	let nameSuffix = $state.raw('');
	let opts = $state<PackageInput>(defaultInput());
	let initialised = $state(false);
	$effect.pre(() => {
		if (initialised) return;
		const suffix =
			mode === 'edit' && existingDaName && tenantSlug
				? existingDaName.replace(new RegExp(`^${tenantSlug}-`), '')
				: '';
		nameSuffix = suffix;
		opts = { ...defaultInput(), ...(initial ?? {}) };
		initialised = true;
	});
	let advancedOpen = $state(false);
	let submitting = $state(false);

	const finalName = $derived(`${(tenantSlug || '').toLowerCase()}-${nameSuffix}`);

	// "Unlimited" toggle for each numeric field. Centralised so the field input
	// gets disabled and falls back to null when "Unlimited" is checked.
	function unlimitedToggle(key: keyof PackageInput) {
		const current = opts[key] as number | null;
		// Toggling on means null; toggling off means restore to last value or 0
		if (current === null) {
			(opts as Record<string, unknown>)[key] = 0;
		} else {
			(opts as Record<string, unknown>)[key] = null;
		}
	}

	function numberOrNull(value: string): number | null {
		if (value === '') return null;
		const n = parseInt(value, 10);
		return Number.isFinite(n) ? n : null;
	}

	async function submit() {
		if (mode === 'new' && !nameSuffix.trim()) {
			toast.error('Numele este obligatoriu');
			return;
		}
		// DA accepts alphanumeric + . - _ in package names. Pre-check so the
		// server-side valibot error doesn't surprise the admin.
		if (mode === 'new' && !/^[A-Za-z0-9._-]+$/.test(nameSuffix)) {
			toast.error('Numele poate conține doar litere, cifre, ".", "-", "_"');
			return;
		}

		submitting = true;
		try {
			if (mode === 'edit') {
				if (!packageId) throw new Error('Lipsește id-ul pachetului');
				await updateDAPackage({ packageId, options: opts });
				toast.success('Pachet actualizat', { description: finalName });
				await onSaved(packageId);
			} else {
				const r = await createDAPackage({
					serverId: daServerId,
					name: nameSuffix,
					options: opts
				});
				toast.success('Pachet creat', { description: r.daName });
				await onSaved(r.id);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="pm-back" role="presentation"></div>
<div
	class="pm-modal"
	role="dialog"
	aria-modal="true"
	aria-labelledby="pm-title"
	use:focusTrap={{ active: true, onEscape: onClose }}
>
	<div class="pm-head">
		<div class="pm-head-icon">
			<PackageIcon size={18} />
		</div>
		<div class="pm-head-text">
			<div class="pm-title" id="pm-title">
				{mode === 'new' ? 'Creează pachet DirectAdmin' : 'Editează pachet DirectAdmin'}
			</div>
			<div class="pm-sub">
				Nume final pe server: <code>{finalName || '(necompletat)'}</code>
			</div>
		</div>
		<button type="button" class="pm-close" aria-label="Închide" onclick={onClose}>
			<XIcon size={14} />
		</button>
	</div>

	<form
		class="pm-body"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		<!-- Section: Identity -->
		<div class="pm-section">
			<div class="pm-section-label">Identitate</div>
			<div class="pm-grid-2">
				<div>
					<label class="pm-label" for="pm-name">Sufix nume *</label>
					<input
						id="pm-name"
						class="pm-input"
						type="text"
						placeholder="ex: Wordpress_Pro"
						bind:value={nameSuffix}
						disabled={mode === 'edit'}
						required
						autocomplete="off"
					/>
					<div class="pm-hint">
						{#if mode === 'new'}
							Apare pe DA ca <code>{finalName || `${tenantSlug}-...`}</code>. Doar litere, cifre, ".",
							"-", "_".
						{:else}
							Numele nu se poate schimba după creare.
						{/if}
					</div>
				</div>
				<div class="pm-grid-2-small">
					<div>
						<label class="pm-label" for="pm-skin">Skin</label>
						<input
							id="pm-skin"
							class="pm-input"
							type="text"
							placeholder="evolution"
							bind:value={opts.skin}
						/>
					</div>
					<div>
						<label class="pm-label" for="pm-lang">Limbă</label>
						<input
							id="pm-lang"
							class="pm-input"
							type="text"
							maxlength="8"
							placeholder="en"
							bind:value={opts.language}
						/>
					</div>
				</div>
			</div>
		</div>

		<!-- Section: Resource limits -->
		<div class="pm-section">
			<div class="pm-section-label">Limite resurse</div>
			<div class="pm-limits">
				{#each [['bandwidth', 'Bandwidth (MB / lună)'], ['quota', 'Spațiu disc (MB)'], ['maxInodes', 'Inodes'], ['maxDomains', 'Domenii'], ['maxSubdomains', 'Sub-domenii'], ['maxDomainPointers', 'Domain pointers'], ['maxEmailAccounts', 'Conturi email'], ['maxEmailForwarders', 'Forwarders email'], ['maxMailingLists', 'Mailing lists'], ['maxAutoresponders', 'Autoresponders'], ['maxDatabases', 'MySQL databases'], ['maxFtpAccounts', 'FTP accounts'], ['emailDailyLimit', 'Email zilnic (max)']] as const as [key, label] (key)}
					{@const k = key as keyof PackageInput}
					{@const value = opts[k] as number | null}
					<div class="pm-limit-row">
						<label class="pm-label sm" for={`pm-${k}`}>{label}</label>
						<div class="pm-limit-input">
							<input
								id={`pm-${k}`}
								class="pm-input"
								type="number"
								min="0"
								step="1"
								value={value ?? ''}
								oninput={(e) => {
									(opts as Record<string, unknown>)[k] = numberOrNull(
										(e.currentTarget as HTMLInputElement).value
									);
								}}
								disabled={value === null}
								placeholder={value === null ? 'Nelimitat' : ''}
							/>
							<label class="pm-unlim">
								<input
									type="checkbox"
									checked={value === null}
									onchange={() => unlimitedToggle(k)}
								/>
								Nelimitat
							</label>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Section: Access flags -->
		<div class="pm-section">
			<div class="pm-section-label">Acces & funcționalități</div>
			<div class="pm-flags">
				{#each [['php', 'PHP Access'], ['ssl', 'SSL Access'], ['ssh', 'SSH Access'], ['cgi', 'CGI Access'], ['cron', 'Cron Jobs'], ['dnsControl', 'DNS Control'], ['spam', 'SpamAssassin'], ['clamav', 'ClamAV'], ['wordpress', 'WordPress'], ['git', 'Git'], ['redis', 'Redis'], ['anonymousFtp', 'Anonymous FTP'], ['suspendAtLimit', 'Suspend at Limit'], ['securityTxt', 'Auto security.txt'], ['jailed', 'Jailed (SSH chroot)'], ['oversold', 'Allow oversell']] as const as [key, label] (key)}
					{@const k = key as keyof PackageInput}
					<label class="pm-flag">
						<input
							type="checkbox"
							checked={opts[k] as boolean}
							onchange={(e) => {
								(opts as Record<string, unknown>)[k] = (e.currentTarget as HTMLInputElement).checked;
							}}
						/>
						<span>{label}</span>
					</label>
				{/each}
			</div>
		</div>

		<!-- Section: Advanced (CPU/IO/memory) -->
		<div class="pm-section pm-advanced">
			<button type="button" class="pm-advanced-toggle" onclick={() => (advancedOpen = !advancedOpen)}>
				{#if advancedOpen}
					<ChevronDownIcon size={12} />
				{:else}
					<ChevronRightIcon size={12} />
				{/if}
				Limite avansate (CPU / IO / memory)
				<span class="pm-advanced-sub">
					{#if advancedOpen}lasă „Nelimitat" dacă nu știi ce să pui{:else}opțional{/if}
				</span>
			</button>
			{#if advancedOpen}
				<div class="pm-limits">
					{#each [['cpuQuota', 'CPU Quota (%)'], ['memoryHigh', 'Memory High (bytes)'], ['memoryMax', 'Memory Max (bytes)'], ['tasksMax', 'Tasks Max'], ['ioReadBandwidthMax', 'IO Read Bandwidth Max (B/s)'], ['ioWriteBandwidthMax', 'IO Write Bandwidth Max (B/s)'], ['iopsReadMax', 'IOPS Read Max'], ['iopsWriteMax', 'IOPS Write Max']] as const as [key, label] (key)}
						{@const k = key as keyof PackageInput}
						{@const value = opts[k] as number | null}
						<div class="pm-limit-row">
							<label class="pm-label sm" for={`pm-${k}`}>{label}</label>
							<div class="pm-limit-input">
								<input
									id={`pm-${k}`}
									class="pm-input"
									type="number"
									min="0"
									step="1"
									value={value ?? ''}
									oninput={(e) => {
										(opts as Record<string, unknown>)[k] = numberOrNull(
											(e.currentTarget as HTMLInputElement).value
										);
									}}
									disabled={value === null}
									placeholder={value === null ? 'Nelimitat' : ''}
								/>
								<label class="pm-unlim">
									<input
										type="checkbox"
										checked={value === null}
										onchange={() => unlimitedToggle(k)}
									/>
									Nelimitat
								</label>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</form>

	<div class="pm-foot">
		<button type="button" class="pm-btn pm-btn-secondary" onclick={onClose} disabled={submitting}>
			Anulează
		</button>
		<div class="pm-foot-spacer"></div>
		<button
			type="button"
			class="pm-btn pm-btn-primary"
			disabled={submitting || (mode === 'new' && !nameSuffix.trim())}
			onclick={submit}
		>
			<CheckIcon size={13} />
			{submitting
				? 'Se salvează…'
				: mode === 'new'
					? 'Creează pachet pe DA'
					: 'Salvează modificările'}
		</button>
	</div>
</div>

<style>
	/* Higher z-index than the parent product modal so this stacks on top */
	.pm-back {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(15, 23, 42, 0.55);
		backdrop-filter: blur(4px);
		animation: pmFadeIn 0.15s;
	}
	@keyframes pmFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.pm-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 820px;
		max-width: calc(100vw - 40px);
		max-height: calc(100vh - 40px);
		background: white;
		z-index: 101;
		border-radius: 14px;
		box-shadow:
			0 28px 64px rgba(15, 23, 42, 0.3),
			0 8px 20px rgba(15, 23, 42, 0.15);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: pmPopIn 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
	}
	@keyframes pmPopIn {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}
	.pm-head {
		padding: 18px 22px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}
	.pm-head-icon {
		width: 36px;
		height: 36px;
		border-radius: 9px;
		background: linear-gradient(135deg, #10b981, #047857);
		color: white;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.pm-head-text {
		flex: 1;
		min-width: 0;
	}
	.pm-title {
		font-size: 16px;
		font-weight: 700;
		color: #0f172a;
	}
	.pm-sub {
		font-size: 12px;
		color: #94a3b8;
		margin-top: 2px;
	}
	.pm-sub code {
		background: #f4f6fa;
		padding: 1px 5px;
		border-radius: 3px;
		font-size: 11px;
		font-family: ui-monospace, monospace;
		color: #475569;
	}
	.pm-close {
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
	.pm-close:hover {
		background: #f4f6fa;
		color: #0f172a;
	}

	.pm-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px 22px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.pm-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pm-section-label {
		font-size: 11.5px;
		font-weight: 700;
		color: #0f172a;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.pm-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.pm-grid-2-small {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.pm-label {
		font-size: 10.5px;
		font-weight: 600;
		color: #475569;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		display: block;
		margin-bottom: 4px;
	}
	.pm-label.sm {
		font-size: 10px;
	}
	.pm-input {
		width: 100%;
		padding: 9px 11px;
		background: white;
		border: 1px solid #d5dbe5;
		border-radius: 7px;
		font-family: inherit;
		font-size: 12.5px;
		color: #0f172a;
		outline: none;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.pm-input:focus {
		border-color: #10b981;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
	}
	.pm-input:disabled {
		background: #fafbfd;
		color: #94a3b8;
		cursor: not-allowed;
	}
	.pm-hint {
		font-size: 10.5px;
		color: #94a3b8;
		margin-top: 4px;
	}
	.pm-hint code {
		background: #f4f6fa;
		padding: 1px 4px;
		border-radius: 3px;
		font-family: ui-monospace, monospace;
		color: #475569;
	}

	.pm-limits {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.pm-limit-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.pm-limit-input {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 6px;
		align-items: center;
	}
	.pm-unlim {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10.5px;
		color: #475569;
		font-weight: 600;
		cursor: pointer;
		padding: 0 4px;
		white-space: nowrap;
	}
	.pm-unlim input[type='checkbox'] {
		width: 14px;
		height: 14px;
		margin: 0;
		accent-color: #10b981;
	}

	.pm-flags {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 6px;
	}
	.pm-flag {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border: 1px solid #e5e9f0;
		border-radius: 7px;
		font-size: 12px;
		color: #475569;
		cursor: pointer;
		transition: all 0.12s;
	}
	.pm-flag:hover {
		border-color: #10b981;
		background: rgba(16, 185, 129, 0.03);
	}
	.pm-flag input[type='checkbox'] {
		width: 15px;
		height: 15px;
		margin: 0;
		accent-color: #10b981;
	}

	.pm-advanced-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		background: transparent;
		border: 1px dashed #cbd5e1;
		border-radius: 7px;
		font-family: inherit;
		font-size: 11.5px;
		font-weight: 700;
		color: #0f172a;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		cursor: pointer;
		align-self: flex-start;
	}
	.pm-advanced-toggle:hover {
		border-color: #10b981;
		color: #047857;
	}
	.pm-advanced-sub {
		font-size: 10px;
		color: #94a3b8;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		margin-left: 4px;
	}

	.pm-foot {
		padding: 14px 22px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		gap: 10px;
		align-items: center;
		background: #fafbfd;
		flex-shrink: 0;
	}
	.pm-foot-spacer {
		flex: 1;
	}
	.pm-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		border: none;
		white-space: nowrap;
	}
	.pm-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.pm-btn-primary {
		background: #10b981;
		color: white;
	}
	.pm-btn-primary:hover:not(:disabled) {
		background: #047857;
	}
	.pm-btn-secondary {
		background: white;
		color: #475569;
		border: 1px solid #d5dbe5;
	}
	.pm-btn-secondary:hover:not(:disabled) {
		border-color: #10b981;
		color: #047857;
	}

	@media (max-width: 900px) {
		.pm-grid-2,
		.pm-limits,
		.pm-flags,
		.pm-grid-2-small {
			grid-template-columns: 1fr;
		}
	}
</style>
