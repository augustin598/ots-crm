<script lang="ts">
	import {
		getClientSecondaryEmails,
		createClientSecondaryEmail,
		deleteClientSecondaryEmail,
		updateClientSecondaryEmailAccess
	} from '$lib/remotes/client-secondary-emails.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		CLIENT_ROLE_PRESETS,
		CLIENT_CUSTOM_PILL,
		detectClientRolePreset,
		getClientRolePreset,
		avatarColor,
		avatarInitials,
		type ClientRolePresetId
	} from '$lib/config/team';
	import { ACCESS_CATEGORIES, NO_ACCESS, type AccessFlags } from '$lib/server/portal-access';
	import TeamMemberCard from './TeamMemberCard.svelte';
	import TeamInviteModal from './TeamInviteModal.svelte';

	let {
		clientId,
		mode = 'admin'
	}: {
		clientId: string;
		mode?: 'admin' | 'client';
	} = $props();

	const secondaryEmailsQuery = $derived(getClientSecondaryEmails(clientId));
	const secondaryEmails = $derived(secondaryEmailsQuery?.current ?? []);

	let inviteOpen = $state(false);
	let editing = $state<{
		id: string;
		email: string;
		flags: AccessFlags;
	} | null>(null);

	const ACCESS_CHIPS: { key: keyof AccessFlags; label: string }[] = [
		{ key: 'invoices', label: 'Facturi' },
		{ key: 'contracts', label: 'Contracte' },
		{ key: 'tasks', label: 'Taskuri' },
		{ key: 'marketing', label: 'Marketing' },
		{ key: 'reports', label: 'Reports' },
		{ key: 'leads', label: 'Leads' },
		{ key: 'accessData', label: 'Date acces' },
		{ key: 'backlinks', label: 'Backlinks' },
		{ key: 'budgets', label: 'Bugete' }
	];

	function resolvedFlags(se: { accessFlagsResolved?: Partial<AccessFlags> | null }): AccessFlags {
		const base: AccessFlags = { ...NO_ACCESS };
		if (se.accessFlagsResolved) {
			for (const k of ACCESS_CATEGORIES) {
				const v = se.accessFlagsResolved[k];
				if (typeof v === 'boolean') base[k] = v;
			}
		}
		return base;
	}

	async function submitInvite({ email, role }: { email: string; role: ClientRolePresetId }) {
		const preset = getClientRolePreset(role);
		if (!preset) throw new Error('Rol invalid');
		const created = await createClientSecondaryEmail({
			clientId,
			email
		}).updates(secondaryEmailsQuery);
		if (created?.id) {
			await updateClientSecondaryEmailAccess({
				secondaryEmailId: created.id,
				accessFlags: preset.flags
			}).updates(secondaryEmailsQuery);
		}
		toast.success(`${email} adăugat cu rolul ${preset.label}.`);
	}

	async function handleDelete(secondaryEmailId: string, email: string) {
		if (!confirm(`Sigur scoți ${email} din echipă?`)) return;
		try {
			await deleteClientSecondaryEmail({ secondaryEmailId }).updates(secondaryEmailsQuery);
			toast.success('Membru scos din echipă.');
		} catch (e) {
			clientLogger.apiError('client_team_delete', e);
			toast.error('Eroare la ștergere.');
		}
	}

	async function handleApplyPreset(secondaryEmailId: string, presetId: ClientRolePresetId) {
		const preset = getClientRolePreset(presetId);
		if (!preset) return;
		try {
			await updateClientSecondaryEmailAccess({
				secondaryEmailId,
				accessFlags: preset.flags
			}).updates(secondaryEmailsQuery);
			if (editing) editing = { ...editing, flags: preset.flags };
		} catch (e) {
			clientLogger.apiError('client_team_apply_preset', e);
		}
	}

	async function handleToggleFlag(secondaryEmailId: string, key: keyof AccessFlags, value: boolean) {
		const se = secondaryEmails.find((s) => s.id === secondaryEmailId);
		if (!se) return;
		const next = { ...resolvedFlags(se), [key]: value };
		try {
			await updateClientSecondaryEmailAccess({
				secondaryEmailId,
				accessFlags: next
			}).updates(secondaryEmailsQuery);
			if (editing && editing.id === secondaryEmailId) {
				editing = { ...editing, flags: next };
			}
		} catch (e) {
			clientLogger.apiError('client_team_toggle_flag', e);
		}
	}

	function openEditor(seId: string) {
		const se = secondaryEmails.find((s) => s.id === seId);
		if (!se) return;
		editing = { id: se.id, email: se.email, flags: resolvedFlags(se) };
	}
</script>

{#if mode === 'admin'}
	<!-- Compact admin list view (preserves the exact behavior of the old inline section) -->
	<div class="space-y-2">
		<div class="flex items-center justify-between">
			<Label>Emailuri Secundare (acces portal)</Label>
			<Button type="button" variant="outline" size="sm" onclick={() => (inviteOpen = true)}>
				<PlusIcon class="h-3.5 w-3.5 mr-1" />
				Adaugă
			</Button>
		</div>
		{#if secondaryEmails.length > 0}
			<div class="space-y-2">
				{#each secondaryEmails as se (se.id)}
					<div class="rounded-lg border bg-card px-3 py-2.5 group hover:bg-muted/30 transition-colors">
						<div class="flex items-center gap-2">
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium">{se.email}</p>
								{#if se.label}
									<p class="text-xs text-muted-foreground">{se.label}</p>
								{/if}
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="h-7 w-7 p-0 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
								onclick={() => handleDelete(se.id, se.email)}
							>
								<TrashIcon class="h-3.5 w-3.5" />
							</Button>
						</div>
						<div class="flex items-start gap-1.5 mt-2 flex-wrap">
							<span class="text-[10px] text-muted-foreground mr-0.5 mt-0.5">Acces:</span>
							{#each ACCESS_CHIPS as chip (chip.key)}
								{@const active = resolvedFlags(se)[chip.key]}
								<button
									type="button"
									class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-all cursor-pointer {active
										? 'bg-primary text-primary-foreground border-primary'
										: 'bg-transparent text-muted-foreground border-muted-foreground/30 hover:border-muted-foreground/50'}"
									onclick={() => handleToggleFlag(se.id, chip.key, !active)}
								>
									{#if active}<CheckIcon class="h-3 w-3" />{/if}
									{chip.label}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
		<p class="text-xs text-muted-foreground">
			Bifați paginile pe care fiecare contact secundar le poate vedea în portal. Notificările
			(Facturi, Taskuri, Contracte) se trimit doar dacă acea categorie e bifată. Contactul
			principal are acces complet automat.
		</p>
	</div>
{:else}
	<!-- Client view: rich card grid -->
	<div class="grid">
		{#each secondaryEmails as se (se.id)}
			{@const flags = resolvedFlags(se)}
			{@const presetId = detectClientRolePreset(flags)}
			{@const presetMeta = presetId === 'custom' ? CLIENT_CUSTOM_PILL : getClientRolePreset(presetId)!}
			<TeamMemberCard
				member={{
					id: se.id,
					email: se.email,
					title: se.label ?? null,
					role: { label: presetMeta.label, color: presetMeta.color, bg: presetMeta.bg }
				}}
				onclick={() => openEditor(se.id)}
			/>
		{/each}
		<button type="button" class="add-card" onclick={() => (inviteOpen = true)}>
			<div class="add-icon"><PlusIcon class="size-6" /></div>
			<strong>Invită un coleg</strong>
			<span>Adaugă un membru nou în echipa ta.</span>
		</button>
	</div>
{/if}

<TeamInviteModal
	bind:open={inviteOpen}
	title={mode === 'admin' ? 'Invită contact secundar' : 'Invită un coleg'}
	description={mode === 'admin'
		? 'Adaugă un email secundar pentru acest client. Setezi accesul prin chip-uri după.'
		: 'Coleg-ul va primi acces la portalul firmei tale cu rolul ales.'}
	roles={CLIENT_ROLE_PRESETS}
	defaultRole={'marketing' as ClientRolePresetId}
	submit={submitInvite}
/>

<!-- Editor drawer (client view only — admin uses inline chips) -->
{#if mode === 'client' && editing}
	{@const cur = editing}
	{@const presetId = detectClientRolePreset(cur.flags)}
	<Dialog.Root open={true} onOpenChange={(v) => { if (!v) editing = null; }}>
		<Dialog.Content class="sm:max-w-[640px]">
			<Dialog.Header>
				<Dialog.Title>Profil membru</Dialog.Title>
				<Dialog.Description>Schimbă rolul sau permisiunile detaliate.</Dialog.Description>
			</Dialog.Header>
			<div class="space-y-4">
				<div class="flex items-center gap-3">
					<div class="av" style="background:{avatarColor(cur.email)}">
						{avatarInitials(null, null, cur.email)}
					</div>
					<div>
						<div class="font-semibold">{cur.email}</div>
						<div class="text-xs text-muted-foreground">
							Rol curent: <strong>{presetId === 'custom' ? CLIENT_CUSTOM_PILL.label : getClientRolePreset(presetId)?.label}</strong>
						</div>
					</div>
				</div>
				<div class="space-y-1.5">
					<Label>Aplică un preset</Label>
					<div class="presets">
						{#each CLIENT_ROLE_PRESETS as r (r.id)}
							<button
								type="button"
								class="preset"
								class:active={presetId === r.id}
								onclick={() => handleApplyPreset(cur.id, r.id)}
							>
								<div class="preset-name">
									<span class="dot" style="background:{r.color}"></span>
									{r.label}
								</div>
								<div class="preset-desc">{r.desc}</div>
							</button>
						{/each}
					</div>
				</div>
				<div class="space-y-1.5">
					<Label>Permisiuni detaliate</Label>
					<div class="flex flex-wrap gap-1.5">
						{#each ACCESS_CHIPS as chip (chip.key)}
							{@const active = cur.flags[chip.key]}
							<button
								type="button"
								class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border transition-all {active
									? 'bg-primary text-primary-foreground border-primary'
									: 'bg-transparent text-muted-foreground border-muted-foreground/30 hover:border-muted-foreground/50'}"
								onclick={() => handleToggleFlag(cur.id, chip.key, !active)}
							>
								{#if active}<CheckIcon class="h-3 w-3" />{/if}
								{chip.label}
							</button>
						{/each}
					</div>
				</div>
			</div>
			<Dialog.Footer>
				<Button
					variant="ghost"
					class="text-destructive border-destructive/30 mr-auto"
					onclick={() => {
						const id = cur.id;
						const em = cur.email;
						editing = null;
						handleDelete(id, em);
					}}
				>
					<TrashIcon class="size-4 mr-1" /> Elimină
				</Button>
				<Button onclick={() => (editing = null)}>
					<XIcon class="size-4 mr-1" /> Închide
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 14px;
	}
	.add-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 28px 16px;
		border: 1.5px dashed var(--border);
		border-radius: 13px;
		background: transparent;
		font-family: inherit;
		color: var(--muted-foreground);
		text-align: center;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
		min-height: 180px;
	}
	.add-card:hover {
		border-color: var(--primary);
		color: var(--primary);
		background: color-mix(in oklch, var(--primary) 4%, transparent);
	}
	.add-icon {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-foreground);
		display: grid;
		place-items: center;
	}
	.add-card strong {
		font-size: 13px;
		color: var(--foreground);
	}
	.add-card span {
		font-size: 11.5px;
	}
	.av {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: white;
		font-weight: 800;
		font-size: 14px;
	}
	.presets {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 8px;
	}
	.preset {
		text-align: left;
		padding: 10px 12px;
		border-radius: 9px;
		border: 1.5px solid var(--border);
		background: var(--card);
		cursor: pointer;
		font-family: inherit;
		color: var(--foreground);
	}
	.preset:hover {
		border-color: var(--primary);
	}
	.preset.active {
		border-color: var(--primary);
		background: color-mix(in oklch, var(--primary) 6%, var(--card));
	}
	.preset-name {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 700;
		font-size: 12.5px;
		margin-bottom: 4px;
	}
	.preset-name .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.preset-desc {
		font-size: 11px;
		color: var(--muted-foreground);
		line-height: 1.35;
	}
</style>
