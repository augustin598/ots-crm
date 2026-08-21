<script lang="ts">
	import {
		getClientSecondaryEmails,
		createClientSecondaryEmail,
		updateClientSecondaryEmailAccess,
		deleteClientSecondaryEmail,
		setClientContactWhatsappPhone,
		getWhatsappGroupsForClient,
		applyWhatsappGroupLinks
	} from '$lib/remotes/client-secondary-emails.remote';
	import IconWhatsapp from '$lib/components/marketing/icon-whatsapp.svelte';
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
		ACCESS_CATEGORY_LABELS,
		emptyAccessFlags,
		type ClientRolePresetId,
		type AccessFlags
	} from '$lib/config/team';
	import { whatsappAvatarUrl } from '$lib/utils/phone';
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
		/** Telefon E.164 care are sigur un avatar WhatsApp stocat; null → inițiale. */
		clientAvatarPhone?: string | null;
		tenantSlug: string;
	};

	let {
		clientId,
		clientName,
		clientEmail,
		clientPhone,
		clientAvatarPhone = null,
		tenantSlug
	}: Props = $props();

	const secondaryEmailsQuery = $derived(getClientSecondaryEmails(clientId));
	const secondaryEmails = $derived(secondaryEmailsQuery?.current ?? []);

	// Inline invite state
	let inviteOpen = $state(false);
	let inviteEmail = $state('');
	let inviteRole = $state<ClientRolePresetId>('marketing');
	let saving = $state(false);

	// Per-row expansion (granular flags editor)
	let expandedRowId = $state<string | null>(null);

	// Import numere din grupuri WhatsApp. Query-ul pornește doar când deschizi
	// panoul — listarea grupurilor e un apel real la WhatsApp, nu-l facem degeaba.
	let importOpen = $state(false);
	let importSaving = $state(false);
	let selectedGroupId = $state<string | null>(null);
	/** phone → secondaryEmailId ales de om ('' = nu lega). Lipsa cheii = propunerea implicită. */
	let importChoice = $state<Record<string, string>>({});

	const importQuery = $derived(importOpen ? getWhatsappGroupsForClient(clientId) : null);
	const importData = $derived(importQuery?.current ?? null);

	type ImportGroup = NonNullable<typeof importData>['groups'][number];
	type ImportMember = ImportGroup['members'][number];

	const selectedGroup = $derived<ImportGroup | null>(
		importData?.connected
			? (importData.groups.find((g) => g.id === selectedGroupId) ?? importData.groups[0] ?? null)
			: null
	);
	const secondaryContacts = $derived(
		importData?.connected
			? importData.contacts.filter((c): c is typeof c & { id: string } => c.kind === 'secondary' && !!c.id)
			: []
	);

	function groupSuggestionCount(g: ImportGroup): number {
		return g.members.filter((m) => m.suggestion).length;
	}

	/** Propunerea implicită: doar potrivirile tari (nume + prenume) se preselectează. */
	function defaultChoiceFor(m: ImportMember): string {
		if (!m.suggestion || m.suggestion.kind !== 'secondary' || !m.suggestion.id) return '';
		return m.suggestion.score >= 1 ? m.suggestion.id : '';
	}

	function alreadyLinkedLabel(phone: string): string | null {
		if (!importData?.connected) return null;
		const c = importData.contacts.find((x) => x.linkedPhone === phone);
		return c ? c.name : null;
	}

	function pendingLinks(): Array<{ secondaryEmailId: string; phone: string }> {
		if (!selectedGroup) return [];
		const out: Array<{ secondaryEmailId: string; phone: string }> = [];
		for (const m of selectedGroup.members) {
			if (alreadyLinkedLabel(m.phone)) continue;
			const id = importChoice[m.phone] ?? defaultChoiceFor(m);
			if (id) out.push({ secondaryEmailId: id, phone: m.phone });
		}
		return out;
	}

	function toggleImport() {
		importOpen = !importOpen;
		if (!importOpen) {
			importChoice = {};
			selectedGroupId = null;
		}
	}

	async function applyImport() {
		const links = pendingLinks();
		if (links.length === 0) return;
		importSaving = true;
		try {
			const res = await applyWhatsappGroupLinks({ clientId, links });
			await secondaryEmailsQuery?.refresh();
			await importQuery?.refresh();
			importChoice = {};
			if (res.applied.length > 0) {
				toast.success(
					`${res.applied.length} ${res.applied.length === 1 ? 'număr legat' : 'numere legate'}. Avatarele se descarcă în fundal.`
				);
			}
			for (const s of res.skipped) toast.error(s.reason);
		} catch (err) {
			clientLogger.apiError('applyWhatsappGroupLinks', err);
			toast.error(err instanceof Error ? err.message : 'Nu am putut lega numerele');
		} finally {
			importSaving = false;
		}
	}

	// Telefon WhatsApp per contact secundar — scrie în user_whatsapp_link.
	let phoneDraft = $state<Record<string, string>>({});
	let phoneSaving = $state<string | null>(null);

	async function savePhone(secondaryEmailId: string, phone: string) {
		phoneSaving = secondaryEmailId;
		try {
			const res = await setClientContactWhatsappPhone({ secondaryEmailId, phone });
			await secondaryEmailsQuery?.refresh();
			toast.success(res.phoneE164 ? `Legat la ${res.phoneE164}` : 'Legătura a fost scoasă');
		} catch (err) {
			clientLogger.apiError('setClientContactWhatsappPhone', err);
			toast.error(err instanceof Error ? err.message : 'Nu am putut salva numărul');
		} finally {
			phoneSaving = null;
		}
	}

	function flagsFromRow(row: { accessFlagsResolved?: AccessFlags }): AccessFlags {
		return row.accessFlagsResolved ?? emptyAccessFlags();
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
				{#if clientAvatarPhone}
					<img
						class="tcp-av-img"
						src={whatsappAvatarUrl(tenantSlug, clientAvatarPhone)}
						alt=""
						loading="lazy"
						onerror={(e) => e.currentTarget.remove()}
					/>
				{/if}
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
				<div class="tcp-head-actions">
					<Button size="sm" variant="ghost" onclick={toggleImport} title="Leagă numerele membrilor dintr-un grup WhatsApp">
						<IconWhatsapp class="size-3.5 mr-1" />
						{importOpen ? 'Închide importul' : 'Importă din grup'}
					</Button>
					<Button size="sm" variant="outline" onclick={() => (inviteOpen = true)}>
						<PlusIcon class="size-3.5 mr-1" />
						Adaugă
					</Button>
				</div>
			{/if}
		</div>

		{#if importOpen}
			<div class="tcp-import">
				{#if importData === null}
					<div class="tcp-import-hint">Se încarcă grupurile…</div>
				{:else if !importData.connected}
					<div class="tcp-import-hint">
						WhatsApp nu e conectat. Conectează-l din pagina WhatsApp, apoi revino.
					</div>
				{:else if importData.groups.length === 0}
					<div class="tcp-import-hint">Contul conectat nu e în niciun grup.</div>
				{:else}
					<label class="tcp-import-label">
						Grupul
						<select
							class="tcp-select tcp-import-select"
							value={selectedGroup?.id ?? ''}
							onchange={(e) => (selectedGroupId = (e.currentTarget as HTMLSelectElement).value)}
						>
							{#each importData.groups as g (g.id)}
								<option value={g.id}>
									{g.subject || '(fără nume)'} · {g.size} membri{groupSuggestionCount(g) > 0
										? ` · ${groupSuggestionCount(g)} potriviri`
										: ''}
								</option>
							{/each}
						</select>
					</label>

					{#if selectedGroup}
						<div class="tcp-import-rows">
							{#each selectedGroup.members as m (m.phone)}
								{@const chosen = importChoice[m.phone] ?? defaultChoiceFor(m)}
								{@const already = alreadyLinkedLabel(m.phone)}
								<div class="tcp-import-row" class:linked={!!already}>
									<div class="tcp-import-who">
										<div class="tcp-import-name">{m.pushName ?? m.phone}</div>
										<div class="tcp-import-phone">
											{m.phone}{m.admin ? ` · ${m.admin === 'superadmin' ? 'creator' : 'admin'}` : ''}
										</div>
									</div>
									{#if already}
										<div class="tcp-import-already">deja legat la {already}</div>
									{:else}
										<select
											class="tcp-select tcp-import-target"
											class:suggested={!!m.suggestion && chosen === m.suggestion.id}
											value={chosen}
											onchange={(e) => (importChoice[m.phone] = (e.currentTarget as HTMLSelectElement).value)}
										>
											<option value="">— nu lega —</option>
											{#each secondaryContacts as c (c.id)}
												<option value={c.id}>
													{c.name}{m.suggestion?.id === c.id
														? m.suggestion.score >= 1 ? ' ✓' : ' ?'
														: ''}
												</option>
											{/each}
											{#if m.suggestion?.kind === 'primary'}
												<option value="" disabled>
													↳ seamănă cu contactul principal — schimbă din „Editează client"
												</option>
											{/if}
										</select>
									{/if}
								</div>
							{/each}
						</div>
						<div class="tcp-import-hint">
							✓ = nume și prenume identice, ? = doar un cuvânt comun. Verifică înainte să aplici.
						</div>
						<div class="tcp-invite-actions">
							<Button size="sm" variant="ghost" onclick={toggleImport}>Anulează</Button>
							<Button size="sm" onclick={applyImport} disabled={importSaving || pendingLinks().length === 0}>
								{importSaving ? 'Se leagă…' : `Leagă ${pendingLinks().length} ${pendingLinks().length === 1 ? 'număr' : 'numere'}`}
							</Button>
						</div>
					{/if}
				{/if}
			</div>
		{/if}

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
								{#if se.avatarPhone}
									<img
										class="tcp-av-img"
										src={whatsappAvatarUrl(tenantSlug, se.avatarPhone)}
										alt=""
										loading="lazy"
										onerror={(e) => e.currentTarget.remove()}
									/>
								{/if}
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
								<div class="tcp-flags-title">Telefon WhatsApp</div>
								<div class="tcp-wa-row">
									<Input
										value={phoneDraft[se.id] ?? se.whatsappPhone ?? ''}
										placeholder="+40712345678"
										oninput={(e) =>
											(phoneDraft[se.id] = (e.currentTarget as HTMLInputElement).value)}
									/>
									<Button
										size="sm"
										disabled={phoneSaving === se.id}
										onclick={() => savePhone(se.id, phoneDraft[se.id] ?? se.whatsappPhone ?? '')}
									>
										{phoneSaving === se.id ? 'Se salvează…' : 'Salvează'}
									</Button>
								</div>
								<div class="tcp-wa-hint">
									Numărul personal de mobil. Din el vine avatarul afișat în taskuri, comentarii și
									echipă. Lasă gol ca să scoți legătura.
								</div>
								<div class="tcp-flags-title tcp-flags-title-spaced">Permisiuni granulare</div>
								<div class="tcp-flags-grid">
									{#each ACCESS_CATEGORIES as cat (cat)}
										<label class="tcp-flag">
											<input
												type="checkbox"
												checked={flags[cat]}
												onchange={() => toggleFlag(se.id, flags, cat)}
											/>
											<span>{ACCESS_CATEGORY_LABELS[cat]}</span>
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
	.tcp-wa-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.tcp-wa-hint {
		font-size: 11.5px;
		color: var(--muted-foreground);
		margin-top: 6px;
		line-height: 1.45;
	}
	.tcp-flags-title-spaced {
		margin-top: 16px;
	}
	.tcp-av-img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.tcp-av {
		position: relative;
		overflow: hidden;
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
	.tcp-head-actions {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.tcp-import {
		border: 1px dashed #25d366;
		border-radius: 10px;
		padding: 12px;
		background: color-mix(in oklch, #25d366 5%, transparent);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.tcp-import-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--muted-foreground);
	}
	.tcp-import-select {
		width: 100%;
		font-weight: 500;
	}
	.tcp-import-rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tcp-import-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 7px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card);
	}
	.tcp-import-row.linked {
		opacity: 0.6;
	}
	.tcp-import-who {
		min-width: 0;
	}
	.tcp-import-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tcp-import-phone {
		font-size: 11.5px;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.tcp-import-target {
		max-width: 240px;
		flex-shrink: 0;
	}
	.tcp-import-target.suggested {
		border-color: #25d366;
	}
	.tcp-import-already {
		font-size: 11.5px;
		color: var(--muted-foreground);
		flex-shrink: 0;
	}
	.tcp-import-hint {
		font-size: 11.5px;
		color: var(--muted-foreground);
		line-height: 1.45;
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
