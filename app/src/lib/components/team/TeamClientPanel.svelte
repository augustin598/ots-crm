<script lang="ts">
	import {
		getClientSecondaryEmails,
		createClientSecondaryEmail,
		updateClientSecondaryEmailAccess,
		deleteClientSecondaryEmail
	} from '$lib/remotes/client-secondary-emails.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import {
		CLIENT_ROLE_PRESETS,
		detectClientRolePreset,
		getClientRolePreset,
		avatarColor,
		avatarInitials,
		ACCESS_CATEGORIES,
		type ClientRolePresetId,
		type AccessFlags
	} from '$lib/config/team';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';

	type Props = {
		clientId: string;
		clientName: string;
		clientEmail: string | null;
		clientPhone: string | null;
		tenantSlug: string;
	};

	let { clientId, clientName, clientEmail, clientPhone, tenantSlug }: Props = $props();

	const secondaryEmailsQuery = $derived(getClientSecondaryEmails(clientId));
	const secondaryEmails = $derived(secondaryEmailsQuery?.current ?? []);

	// Inline invite state
	let inviteOpen = $state(false);
	let inviteEmail = $state('');
	let inviteRole = $state<ClientRolePresetId>('marketing');
	let saving = $state(false);

	// Per-row expansion (granular flags editor)
	let expandedRowId = $state<string | null>(null);

	const CATEGORY_LABELS: Record<string, string> = {
		invoices: 'Facturi',
		contracts: 'Contracte',
		tasks: 'Taskuri',
		marketing: 'Marketing',
		reports: 'Rapoarte',
		leads: 'Leads',
		accessData: 'Date acces',
		backlinks: 'Backlinks',
		budgets: 'Bugete',
		hosting: 'Hosting'
	};

	function flagsFromRow(row: { accessFlagsResolved?: AccessFlags }): AccessFlags {
		return (
			row.accessFlagsResolved ?? {
				invoices: false,
				contracts: false,
				tasks: false,
				marketing: false,
				reports: false,
				leads: false,
				accessData: false,
				backlinks: false,
				budgets: false,
				hosting: false
			}
		);
	}

	function detectRoleForRow(row: { accessFlagsResolved?: AccessFlags }): {
		id: ClientRolePresetId | 'custom';
		label: string;
		color: string;
		bg: string;
	} {
		const flags = flagsFromRow(row);
		const id = detectClientRolePreset(flags);
		if (id === 'custom') {
			return { id, label: 'Custom', color: '#475569', bg: '#e2e8f0' };
		}
		const preset = getClientRolePreset(id)!;
		return { id: preset.id, label: preset.label, color: preset.color, bg: preset.bg };
	}

	async function handleInvite() {
		const trimmed = inviteEmail.trim();
		if (!trimmed) return;
		const preset = getClientRolePreset(inviteRole);
		if (!preset) {
			toast.error('Rol invalid');
			return;
		}
		saving = true;
		try {
			const created = await createClientSecondaryEmail({
				clientId,
				email: trimmed
			}).updates(secondaryEmailsQuery);
			if (created?.id) {
				await updateClientSecondaryEmailAccess({
					secondaryEmailId: created.id,
					accessFlags: preset.flags
				}).updates(secondaryEmailsQuery);
			}
			toast.success(`${trimmed} adăugat cu rolul ${preset.label}.`);
			inviteEmail = '';
			inviteOpen = false;
		} catch (e) {
			clientLogger.apiError('team_client_panel_invite', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la invitație.');
		} finally {
			saving = false;
		}
	}

	async function applyPreset(secondaryEmailId: string, presetId: ClientRolePresetId) {
		const preset = getClientRolePreset(presetId);
		if (!preset) return;
		try {
			await updateClientSecondaryEmailAccess({
				secondaryEmailId,
				accessFlags: preset.flags
			}).updates(secondaryEmailsQuery);
			toast.success(`Rol setat: ${preset.label}.`);
		} catch (e) {
			clientLogger.apiError('team_client_panel_apply_preset', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la setare rol.');
		}
	}

	async function toggleFlag(
		secondaryEmailId: string,
		current: AccessFlags,
		category: string
	) {
		const next: AccessFlags = { ...current, [category]: !current[category as keyof AccessFlags] };
		try {
			await updateClientSecondaryEmailAccess({
				secondaryEmailId,
				accessFlags: next
			}).updates(secondaryEmailsQuery);
		} catch (e) {
			clientLogger.apiError('team_client_panel_toggle_flag', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la modificare permisiune.');
		}
	}

	async function handleDelete(secondaryEmailId: string, email: string) {
		if (!confirm(`Sigur scoți ${email} din echipă?`)) return;
		try {
			await deleteClientSecondaryEmail({ secondaryEmailId }).updates(secondaryEmailsQuery);
			toast.success('Membru scos din echipă.');
		} catch (e) {
			clientLogger.apiError('team_client_panel_delete', e);
			toast.error('Eroare la ștergere.');
		}
	}
</script>

<div class="tcp">
	<!-- Header: client name + link to edit page -->
	<div class="tcp-header">
		<div>
			<div class="tcp-title">{clientName}</div>
			<div class="tcp-sub">Echipa clientului — contacte cu acces la portal</div>
		</div>
		<a
			class="tcp-link"
			href={`/${tenantSlug}/clients/${clientId}/edit`}
			target="_blank"
			rel="noopener"
		>
			<ExternalLinkIcon class="size-3.5" />
			Editează client
		</a>
	</div>

	<!-- Primary contact section -->
	<section class="tcp-section">
		<div class="tcp-section-head">
			<h3 class="tcp-section-title">Contact principal</h3>
			<span class="tcp-pill tcp-pill-primary">
				<ShieldCheckIcon class="size-3" />
				Acces total
			</span>
		</div>
		<div class="tcp-row">
			<div class="tcp-av" style="background:{avatarColor(clientId)}">
				{avatarInitials(clientName, null, clientEmail)}
			</div>
			<div class="tcp-row-info">
				<div class="tcp-row-name">{clientName}</div>
				<div class="tcp-row-meta">
					{#if clientEmail}
						<span class="tcp-meta-item">
							<MailIcon class="size-3" />
							<a href={`mailto:${clientEmail}`}>{clientEmail}</a>
						</span>
					{/if}
					{#if clientPhone}
						<span class="tcp-meta-item">
							<PhoneIcon class="size-3" />
							<a href={`tel:${clientPhone}`}>{clientPhone}</a>
						</span>
					{/if}
					{#if !clientEmail && !clientPhone}
						<span class="tcp-empty">Fără date contact — adaugă din pagina de editare client.</span>
					{/if}
				</div>
			</div>
		</div>
	</section>

	<!-- Secondary contacts section -->
	<section class="tcp-section">
		<div class="tcp-section-head">
			<h3 class="tcp-section-title">
				Contacte secundare
				<span class="tcp-count">{secondaryEmails.length}</span>
			</h3>
			{#if !inviteOpen}
				<Button size="sm" variant="outline" onclick={() => (inviteOpen = true)}>
					<PlusIcon class="size-3.5 mr-1" />
					Adaugă
				</Button>
			{/if}
		</div>

		{#if inviteOpen}
			<div class="tcp-invite">
				<div class="tcp-invite-row">
					<Input
						type="email"
						placeholder="email@firma.ro"
						bind:value={inviteEmail}
						class="flex-1"
					/>
					<select
						class="tcp-select"
						bind:value={inviteRole}
						aria-label="Rol"
					>
						{#each CLIENT_ROLE_PRESETS as p (p.id)}
							<option value={p.id}>{p.label}</option>
						{/each}
					</select>
				</div>
				<div class="tcp-invite-actions">
					<Button
						size="sm"
						variant="ghost"
						onclick={() => {
							inviteOpen = false;
							inviteEmail = '';
						}}
					>
						Anulează
					</Button>
					<Button size="sm" onclick={handleInvite} disabled={saving || !inviteEmail.trim()}>
						{saving ? 'Se trimite...' : 'Trimite invitație'}
					</Button>
				</div>
			</div>
		{/if}

		{#if secondaryEmails.length === 0}
			<div class="tcp-empty-state">
				Niciun contact secundar. Folosește butonul „Adaugă" pentru a invita un coleg.
			</div>
		{:else}
			<div class="tcp-list">
				{#each secondaryEmails as se (se.id)}
					{@const roleMeta = detectRoleForRow(se)}
					{@const flags = flagsFromRow(se)}
					{@const expanded = expandedRowId === se.id}
					<div class="tcp-srow" class:expanded>
						<div class="tcp-srow-head">
							<div class="tcp-av tcp-av-sm" style="background:{avatarColor(se.email)}">
								{avatarInitials(null, null, se.email)}
							</div>
							<div class="tcp-srow-info">
								<div class="tcp-row-name">{se.email}</div>
								{#if se.label}
									<div class="tcp-row-label">{se.label}</div>
								{/if}
							</div>
							<select
								class="tcp-role-select"
								value={roleMeta.id}
								style="background:{roleMeta.bg}; color:{roleMeta.color}"
								onchange={(e) => {
									const value = (e.currentTarget as HTMLSelectElement).value;
									if (value !== 'custom') {
										applyPreset(se.id, value as ClientRolePresetId);
									}
								}}
							>
								{#each CLIENT_ROLE_PRESETS as p (p.id)}
									<option value={p.id}>{p.label}</option>
								{/each}
								{#if roleMeta.id === 'custom'}
									<option value="custom">Custom</option>
								{/if}
							</select>
							<button
								type="button"
								class="tcp-expand"
								class:open={expanded}
								onclick={() => (expandedRowId = expanded ? null : se.id)}
								aria-label={expanded ? 'Restrânge' : 'Permisiuni detaliate'}
								title="Permisiuni detaliate"
							>
								<ChevronDownIcon class="size-3.5" />
							</button>
							<button
								type="button"
								class="tcp-trash"
								onclick={() => handleDelete(se.id, se.email)}
								aria-label="Șterge"
								title="Scoate din echipă"
							>
								<TrashIcon class="size-3.5" />
							</button>
						</div>
						{#if expanded}
							<div class="tcp-flags">
								<div class="tcp-flags-title">Permisiuni granulare</div>
								<div class="tcp-flags-grid">
									{#each ACCESS_CATEGORIES as cat (cat)}
										<label class="tcp-flag">
											<input
												type="checkbox"
												checked={flags[cat]}
												onchange={() => toggleFlag(se.id, flags, cat)}
											/>
											<span>{CATEGORY_LABELS[cat] ?? cat}</span>
										</label>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.tcp {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.tcp-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--border);
	}
	.tcp-title {
		font-size: 18px;
		font-weight: 700;
		color: var(--foreground);
	}
	.tcp-sub {
		font-size: 12px;
		color: var(--muted-foreground);
		margin-top: 2px;
	}
	.tcp-link {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-weight: 600;
		color: var(--primary);
		text-decoration: none;
		padding: 6px 10px;
		border-radius: 7px;
		border: 1px solid var(--border);
		background: var(--card);
	}
	.tcp-link:hover {
		border-color: var(--primary);
		background: color-mix(in oklch, var(--primary) 6%, transparent);
	}
	.tcp-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.tcp-section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.tcp-section-title {
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-foreground);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.tcp-count {
		background: color-mix(in oklch, var(--foreground) 6%, transparent);
		color: var(--muted-foreground);
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 11px;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 700;
	}
	.tcp-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.tcp-pill-primary {
		background: #fef2f2;
		color: #dc2626;
	}
	.tcp-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
		border-radius: 10px;
		background: color-mix(in oklch, var(--foreground) 3%, transparent);
		border: 1px solid var(--border);
	}
	.tcp-av {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: white;
		font-weight: 800;
		font-size: 13px;
		flex-shrink: 0;
	}
	.tcp-av-sm {
		width: 32px;
		height: 32px;
		font-size: 11.5px;
	}
	.tcp-row-info {
		min-width: 0;
		flex: 1;
	}
	.tcp-row-name {
		font-size: 13px;
		font-weight: 700;
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tcp-row-label {
		font-size: 11px;
		color: var(--muted-foreground);
		margin-top: 1px;
	}
	.tcp-row-meta {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		font-size: 12px;
		color: var(--muted-foreground);
		margin-top: 4px;
	}
	.tcp-meta-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.tcp-meta-item a {
		color: inherit;
		text-decoration: none;
	}
	.tcp-meta-item a:hover {
		color: var(--primary);
		text-decoration: underline;
	}
	.tcp-empty {
		font-style: italic;
		color: var(--muted-foreground);
		font-size: 12px;
	}
	.tcp-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.tcp-srow {
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--card);
		overflow: hidden;
		transition: border-color 0.12s;
	}
	.tcp-srow:hover,
	.tcp-srow.expanded {
		border-color: color-mix(in oklch, var(--primary) 35%, var(--border));
	}
	.tcp-srow-head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
	}
	.tcp-srow-info {
		min-width: 0;
		flex: 1;
	}
	.tcp-role-select {
		appearance: none;
		border: none;
		padding: 4px 22px 4px 9px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-family: inherit;
		cursor: pointer;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3'><path d='m6 9 6 6 6-6'/></svg>");
		background-repeat: no-repeat;
		background-position: right 6px center;
		background-size: 10px 10px;
	}
	.tcp-role-select:focus {
		outline: 2px solid color-mix(in oklch, var(--primary) 40%, transparent);
		outline-offset: 1px;
	}
	.tcp-expand,
	.tcp-trash {
		width: 28px;
		height: 28px;
		border-radius: 7px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--muted-foreground);
		display: grid;
		place-items: center;
		cursor: pointer;
		transition: all 0.12s;
	}
	.tcp-expand:hover {
		border-color: var(--border);
		color: var(--foreground);
	}
	.tcp-expand.open {
		transform: rotate(180deg);
		color: var(--primary);
	}
	.tcp-trash:hover {
		border-color: #fecaca;
		background: #fef2f2;
		color: #dc2626;
	}
	.tcp-flags {
		padding: 12px 12px 14px;
		border-top: 1px dashed var(--border);
		background: color-mix(in oklch, var(--foreground) 2%, transparent);
	}
	.tcp-flags-title {
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-foreground);
		margin-bottom: 8px;
	}
	.tcp-flags-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 6px 12px;
	}
	.tcp-flag {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--foreground);
		cursor: pointer;
	}
	.tcp-flag input {
		accent-color: var(--primary);
		cursor: pointer;
	}
	.tcp-invite {
		border: 1px dashed var(--primary);
		border-radius: 10px;
		padding: 12px;
		background: color-mix(in oklch, var(--primary) 4%, transparent);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.tcp-invite-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.tcp-select {
		padding: 6px 26px 6px 10px;
		border: 1px solid var(--border);
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 600;
		background-color: var(--card);
		color: var(--foreground);
		font-family: inherit;
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>");
		background-repeat: no-repeat;
		background-position: right 8px center;
		background-size: 12px 12px;
	}
	.tcp-invite-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.tcp-empty-state {
		text-align: center;
		padding: 24px;
		color: var(--muted-foreground);
		font-size: 12.5px;
		border: 1px dashed var(--border);
		border-radius: 10px;
		background: color-mix(in oklch, var(--foreground) 2%, transparent);
	}
</style>
