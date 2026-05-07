<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import PauseIcon from '@lucide/svelte/icons/pause-circle';
	import PlayIcon from '@lucide/svelte/icons/play-circle';
	import {
		ADMIN_ROLES,
		DEPARTMENTS,
		TEAM_SKILLS,
		avatarColor,
		avatarInitials,
		type AdminRoleId,
		type DepartmentId
	} from '$lib/config/team';
	import {
		capabilitiesByGroup,
		getCapabilitiesForRole,
		type Capability
	} from '$lib/access/catalog';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ShieldIcon from '@lucide/svelte/icons/shield';

	export interface ProfileMember {
		tenantUserId: string;
		userId: string;
		email: string;
		firstName: string | null;
		lastName: string | null;
		title: string | null;
		phone: string | null;
		role: string;
		department: string | null;
		skills: string[];
		hourlyRate: string | null;
		status: 'active' | 'suspended';
		joinedAt: Date | string | null;
		isYou: boolean;
		isOwner: boolean;
		online: boolean;
		stats: { active: number; done: number; onTime: number | null } | null;
		/** JSON array of capability IDs (override) or null = use role defaults. */
		capabilities: string | null;
	}

	let {
		open = $bindable(false),
		member,
		actorRole,
		onChangeRole,
		onSaveMeta,
		onSaveSkills,
		onSaveCapabilities,
		onRemove,
		onSuspend,
		onReactivate
	}: {
		open?: boolean;
		member: ProfileMember | null;
		actorRole: 'owner' | 'admin' | 'manager' | 'member' | 'viewer';
		onChangeRole: (role: AdminRoleId) => Promise<void> | void;
		onSaveMeta: (patch: {
			department?: DepartmentId | null;
			title?: string | null;
			hourlyRate?: string | null;
		}) => Promise<void> | void;
		onSaveSkills: (skills: string[]) => Promise<void> | void;
		onSaveCapabilities?: (capabilities: string[] | null) => Promise<void> | void;
		onRemove: () => Promise<void> | void;
		onSuspend: () => Promise<void> | void;
		onReactivate: () => Promise<void> | void;
	} = $props();

	let titleDraft = $state('');
	let rateDraft = $state('');
	let skillsDraft = $state<string[]>([]);
	let newSkill = $state('');
	let busy = $state(false);

	// Capability override state
	let capsExpanded = $state(false);
	let capsDraft = $state<Set<string>>(new Set());
	let capsHasOverride = $state(false);

	$effect(() => {
		if (member) {
			titleDraft = member.title ?? '';
			rateDraft = member.hourlyRate ?? '';
			skillsDraft = [...member.skills];

			// Initialize capabilities draft from member's override or role defaults
			if (member.capabilities) {
				try {
					const parsed = JSON.parse(member.capabilities);
					if (Array.isArray(parsed)) {
						capsDraft = new Set(parsed.filter((s) => typeof s === 'string'));
						capsHasOverride = true;
					} else {
						capsDraft = new Set(getCapabilitiesForRole(member.role as AdminRoleId));
						capsHasOverride = false;
					}
				} catch {
					capsDraft = new Set(getCapabilitiesForRole(member.role as AdminRoleId));
					capsHasOverride = false;
				}
			} else {
				capsDraft = new Set(getCapabilitiesForRole(member.role as AdminRoleId));
				capsHasOverride = false;
			}
		}
	});

	const adminCapGroups = $derived(capabilitiesByGroup('admin'));

	function toggleCap(id: string) {
		const next = new Set(capsDraft);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		capsDraft = next;
		capsHasOverride = true;
	}

	function resetCapsToRoleDefault() {
		if (!member) return;
		capsDraft = new Set(getCapabilitiesForRole(member.role as AdminRoleId));
		capsHasOverride = false;
	}

	const canActorChangeRole = $derived.by(() => {
		if (!member) return false;
		return actorRole === 'owner' && !member.isOwner && !member.isYou;
	});
	const canActorRemove = $derived.by(() => {
		if (!member) return false;
		return (actorRole === 'owner' || actorRole === 'admin') && !member.isOwner && !member.isYou;
	});
	const canActorSuspend = $derived(canActorRemove);
	const canEditSkills = $derived.by(() => {
		if (!member) return false;
		if (member.isYou) return true;
		return actorRole === 'owner' || actorRole === 'admin' || actorRole === 'manager';
	});

	const initials = $derived(member ? avatarInitials(member.firstName, member.lastName, member.email) : '?');
	const color = $derived(member ? avatarColor(member.email) : '#1877F2');
	const displayName = $derived(
		member ? [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || member.email : ''
	);
	const dept = $derived(
		member ? DEPARTMENTS.find((d) => d.id === member.department) ?? null : null
	);
	const role = $derived(member ? ADMIN_ROLES.find((r) => r.id === member.role) ?? null : null);
	const dateFmt = new Intl.DateTimeFormat('ro-RO', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
	const hiredLabel = $derived(member?.joinedAt ? dateFmt.format(new Date(member.joinedAt)) : '—');

	function addSkill(label: string) {
		const v = label.trim();
		if (!v) return;
		if (skillsDraft.includes(v)) return;
		if (skillsDraft.length >= 30) return;
		skillsDraft = [...skillsDraft, v];
		newSkill = '';
	}

	function removeSkill(s: string) {
		skillsDraft = skillsDraft.filter((x) => x !== s);
	}

	async function handleSaveAll() {
		if (!member) return;
		busy = true;
		try {
			const patch: { title?: string | null; hourlyRate?: string | null; department?: DepartmentId | null } = {};
			if (titleDraft.trim() !== (member.title ?? '')) {
				patch.title = titleDraft.trim() || null;
			}
			const rateVal = rateDraft.trim();
			if (rateVal !== (member.hourlyRate ?? '')) {
				patch.hourlyRate = rateVal || null;
			}
			if (Object.keys(patch).length > 0) await onSaveMeta(patch);
			const before = JSON.stringify([...member.skills].sort());
			const after = JSON.stringify([...skillsDraft].sort());
			if (before !== after) await onSaveSkills(skillsDraft);

			// Capabilities override save
			if (onSaveCapabilities) {
				const roleDefaults = new Set(getCapabilitiesForRole(member.role as AdminRoleId));
				const draftStr = JSON.stringify([...capsDraft].sort());
				const defaultStr = JSON.stringify([...roleDefaults].sort());
				const memberCurrentStr = member.capabilities;

				if (capsHasOverride && draftStr !== defaultStr) {
					// Save override (only if different from current persisted)
					if (memberCurrentStr !== draftStr) {
						await onSaveCapabilities([...capsDraft]);
					}
				} else if (!capsHasOverride && memberCurrentStr !== null) {
					// Clear override
					await onSaveCapabilities(null);
				}
			}
		} finally {
			busy = false;
		}
	}

	async function handleDeptChange(value: string) {
		if (!member) return;
		const newDept = (value === '' ? null : value) as DepartmentId | null;
		await onSaveMeta({ department: newDept });
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[640px] team-profile-modal">
		<Dialog.Header>
			<Dialog.Title>Profil membru</Dialog.Title>
		</Dialog.Header>

		{#if member}
			<div class="profile-body">
				<!-- Header -->
				<div class="profile-head">
					<div class="av-wrap">
						<div class="av-large" style="background:{color}">{initials}</div>
						<span class="presence" class:online={member.online} class:offline={!member.online}></span>
					</div>
					<div class="profile-head-info">
						<div class="name">
							{displayName}
							{#if member.isYou}<span class="you">tu</span>{/if}
							{#if member.status === 'suspended'}
								<span class="suspended">suspendat</span>
							{/if}
						</div>
						<div class="sub">
							{#if member.title}{member.title}{/if}
							{#if member.title && dept} · {/if}
							{#if dept}<span style="color:{dept.color}">{dept.label}</span>{/if}
						</div>
						<div class="muted small">
							{member.email}{#if member.phone} · {member.phone}{/if}
						</div>
					</div>
				</div>

				<!-- Stats grid -->
				{#if member.stats}
					<div class="stats-grid">
						<div class="stat">
							<div class="stat-lbl">Active</div>
							<div class="stat-val">{member.stats.active}</div>
						</div>
						<div class="stat">
							<div class="stat-lbl">Done</div>
							<div class="stat-val">{member.stats.done}</div>
						</div>
						<div class="stat">
							<div class="stat-lbl">On-time</div>
							<div
								class="stat-val"
								class:green={member.stats.onTime !== null && member.stats.onTime >= 90}
								class:warn={member.stats.onTime !== null && member.stats.onTime < 90}
							>
								{member.stats.onTime !== null ? `${member.stats.onTime}%` : '—'}
							</div>
						</div>
					</div>
				{/if}

				<!-- Department & Title -->
				{#if !member.isYou && !member.isOwner}
					<div class="fld-row">
						<div class="fld">
							<Label class="fld-label">Departament</Label>
							<select
								class="meta-select"
								value={member.department ?? ''}
								onchange={(e) => handleDeptChange((e.currentTarget as HTMLSelectElement).value)}
							>
								<option value="">— Fără —</option>
								{#each DEPARTMENTS as d (d.id)}
									<option value={d.id}>{d.label}</option>
								{/each}
							</select>
						</div>
						<div class="fld">
							<Label class="fld-label">Titlu</Label>
							<Input bind:value={titleDraft} placeholder="ex: Marketing Specialist" />
						</div>
					</div>
				{/if}

				<!-- Skills -->
				<div class="fld">
					<Label class="fld-label">Skills</Label>
					<div class="skills-list">
						{#each skillsDraft as s (s)}
							<span class="skill-chip">
								{s}
								{#if canEditSkills}
									<button type="button" aria-label="Șterge skill" onclick={() => removeSkill(s)}>
										<XIcon class="size-3" />
									</button>
								{/if}
							</span>
						{/each}
						{#if canEditSkills}
							<div class="skill-add">
								<input
									type="text"
									placeholder="+ Adaugă skill"
									list="team-skills-suggest"
									bind:value={newSkill}
									onkeydown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault();
											addSkill(newSkill);
										}
									}}
								/>
								<datalist id="team-skills-suggest">
									{#each TEAM_SKILLS as s (s)}
										<option value={s}></option>
									{/each}
								</datalist>
								<button
									type="button"
									class="skill-add-btn"
									onclick={() => addSkill(newSkill)}
									disabled={!newSkill.trim()}
									aria-label="Adaugă"
								>
									<PlusIcon class="size-3" />
								</button>
							</div>
						{/if}
					</div>
				</div>

				<!-- Rate & Hired -->
				<div class="fld-row">
					<div class="fld">
						<Label class="fld-label">Rate / oră</Label>
						<Input bind:value={rateDraft} placeholder="ex: €55/h sau —" />
					</div>
					<div class="fld">
						<Label class="fld-label">Hired</Label>
						<Input value={hiredLabel} readonly />
					</div>
				</div>

				<!-- Role -->
				<div class="fld">
					<Label class="fld-label">Rol</Label>
					{#if canActorChangeRole}
						<div class="role-row">
							{#each ADMIN_ROLES.filter((r) => r.id !== 'owner') as r (r.id)}
								<button
									type="button"
									class="role-btn"
									class:active={member.role === r.id}
									style:--rcolor={r.color}
									style:--rbg={r.bg}
									onclick={() => onChangeRole(r.id)}
									disabled={member.role === r.id}
								>
									<span class="dot" style="background:{r.color}"></span>
									{r.label}
								</button>
							{/each}
						</div>
					{:else}
						<div class="muted small">
							{#if role}
								<span class="pill" style="background:{role.bg}; color:{role.color}">
									<span class="dot" style="background:{role.color}"></span>
									{role.label}
								</span>
							{/if}
							{#if member.isYou}
								&nbsp;Nu îți poți modifica propriul rol.
							{:else if member.isOwner}
								&nbsp;Owner — folosește Transfer Ownership (urmează în v2).
							{:else}
								&nbsp;Doar Owner-ul poate schimba roluri.
							{/if}
						</div>
					{/if}
				</div>

				<!-- Permisiuni avansate (per-user override) -->
				{#if onSaveCapabilities && actorRole === 'owner' && !member.isOwner}
					<div class="fld">
						<button type="button" class="caps-toggle" onclick={() => (capsExpanded = !capsExpanded)}>
							{#if capsExpanded}<ChevronDownIcon class="size-3.5" />{:else}<ChevronRightIcon class="size-3.5" />{/if}
							<ShieldIcon class="size-3.5" />
							<span>Permisiuni avansate</span>
							{#if capsHasOverride}
								<span class="caps-custom-badge">Custom</span>
							{:else}
								<span class="caps-default-hint">— folosește preset rol —</span>
							{/if}
						</button>
						{#if capsExpanded}
							<div class="caps-body">
								<div class="caps-row-actions">
									<button
										type="button"
										class="caps-reset-btn"
										onclick={resetCapsToRoleDefault}
										disabled={!capsHasOverride}
									>
										Resetează la preset rol
									</button>
									<span class="caps-hint">
										Bifează individual pentru a permite acest membru capacități în plus față de rol.
									</span>
								</div>
								{#each Array.from(adminCapGroups.entries()) as [groupName, items] (groupName)}
									<div class="caps-group">
										<div class="caps-group-label">{groupName}</div>
										{#each items as cap (cap.id)}
											<label class="caps-row">
												<input
													type="checkbox"
													checked={capsDraft.has(cap.id)}
													onchange={() => toggleCap(cap.id)}
													disabled={cap.unsafeUnlessRole !== undefined && cap.unsafeUnlessRole !== member.role}
												/>
												<span class="caps-row-label">
													{cap.label}
													{#if cap.unsafeUnlessRole}
														<span class="caps-warn">doar {cap.unsafeUnlessRole}</span>
													{/if}
												</span>
												{#if cap.description}
													<span class="caps-desc">{cap.description}</span>
												{/if}
											</label>
										{/each}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<Dialog.Footer>
				<div class="footer-row">
					<div class="left">
						{#if canActorSuspend}
							{#if member.status === 'active'}
								<Button
									variant="ghost"
									class="text-amber-600 border-amber-300 hover:bg-amber-50"
									onclick={() => onSuspend()}
								>
									<PauseIcon class="size-4 mr-1" /> Suspendă cont
								</Button>
							{:else}
								<Button variant="ghost" class="text-emerald-700" onclick={() => onReactivate()}>
									<PlayIcon class="size-4 mr-1" /> Reactivează
								</Button>
							{/if}
						{/if}
						{#if canActorRemove}
							<Button
								variant="ghost"
								class="text-destructive border-destructive/30"
								onclick={() => onRemove()}
							>
								<TrashIcon class="size-4 mr-1" /> Scoate din echipă
							</Button>
						{/if}
					</div>
					<div class="right">
						<Button variant="ghost" onclick={() => (open = false)}>Anulează</Button>
						<Button onclick={handleSaveAll} disabled={busy}>
							<CheckIcon class="size-4 mr-1" />
							{busy ? 'Salvează...' : 'Salvează'}
						</Button>
					</div>
				</div>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	.profile-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.profile-head {
		display: flex;
		gap: 14px;
		align-items: center;
	}
	.av-wrap {
		position: relative;
		flex-shrink: 0;
	}
	.av-large {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: white;
		font-weight: 800;
		font-size: 22px;
	}
	.presence {
		position: absolute;
		bottom: 1px;
		right: 1px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2.5px solid var(--card);
	}
	.presence.online {
		background: #10b981;
	}
	.presence.offline {
		background: #cbd5e1;
	}
	.profile-head-info {
		min-width: 0;
		flex: 1;
	}
	.name {
		font-size: 18px;
		font-weight: 800;
		color: var(--foreground);
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.you {
		background: var(--accent);
		color: var(--accent-foreground);
		font-size: 9px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.suspended {
		background: #fef3c7;
		color: #b45309;
		font-size: 9px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.sub {
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.muted {
		color: var(--muted-foreground);
	}
	.small {
		font-size: 12px;
	}
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
	}
	.stat {
		background: color-mix(in oklch, var(--foreground) 3%, transparent);
		padding: 12px;
		border-radius: 10px;
	}
	.stat-lbl {
		font-size: 10px;
		font-weight: 700;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.stat-val {
		font-size: 20px;
		font-weight: 800;
		color: var(--foreground);
		margin-top: 2px;
	}
	.stat-val.green {
		color: #10b981;
	}
	.stat-val.warn {
		color: #f59e0b;
	}
	.fld-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.fld {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	:global(.team-profile-modal .fld-label) {
		font-size: 11px;
		font-weight: 700;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.meta-select {
		width: 100%;
		padding: 8px 32px 8px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card);
		color: var(--foreground);
		font-size: 14px;
		font-family: inherit;
		appearance: none;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>");
		background-repeat: no-repeat;
		background-position: right 10px center;
		background-size: 14px 14px;
	}
	.meta-select:focus {
		outline: none;
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.skills-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		min-height: 32px;
		align-items: center;
	}
	.skill-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 9px;
		border-radius: 999px;
		font-size: 11.5px;
		font-weight: 600;
		background: color-mix(in oklch, var(--foreground) 5%, transparent);
		color: var(--foreground);
	}
	.skill-chip button {
		background: transparent;
		border: none;
		color: var(--muted-foreground);
		cursor: pointer;
		display: inline-flex;
		padding: 0;
	}
	.skill-chip button:hover {
		color: #ef4444;
	}
	.skill-add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 1px dashed var(--border);
		border-radius: 999px;
		padding: 2px 4px 2px 10px;
		background: var(--card);
	}
	.skill-add input {
		border: none;
		outline: none;
		background: transparent;
		font-size: 11.5px;
		font-family: inherit;
		color: var(--foreground);
		width: 130px;
	}
	.skill-add-btn {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: none;
		background: var(--primary);
		color: var(--primary-foreground);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.skill-add-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.role-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.role-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		border: 1px solid var(--border);
		background: var(--card);
		color: var(--foreground);
		font-family: inherit;
		cursor: pointer;
		transition: all 0.12s;
	}
	.role-btn:hover:not(:disabled) {
		border-color: var(--rcolor);
		color: var(--rcolor);
	}
	.role-btn.active {
		background: var(--rbg);
		border-color: var(--rcolor);
		color: var(--rcolor);
		cursor: default;
	}
	.role-btn .dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
	}
	.pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.footer-row {
		display: flex;
		width: 100%;
		justify-content: space-between;
		gap: 8px;
	}
	.footer-row .left,
	.footer-row .right {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	/* Capabilities advanced section */
	.caps-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: 1px dashed var(--border);
		border-radius: 8px;
		padding: 8px 12px;
		font-family: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--foreground);
		cursor: pointer;
		width: 100%;
		justify-content: flex-start;
	}
	.caps-toggle:hover {
		border-color: var(--primary);
	}
	.caps-custom-badge {
		font-size: 10px;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		color: var(--primary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-left: auto;
	}
	.caps-default-hint {
		font-size: 11px;
		font-weight: 500;
		color: var(--muted-foreground);
		margin-left: auto;
		font-style: italic;
	}
	.caps-body {
		margin-top: 8px;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: color-mix(in oklch, var(--foreground) 2%, transparent);
		max-height: 320px;
		overflow-y: auto;
	}
	.caps-row-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 10px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--border);
	}
	.caps-reset-btn {
		font-size: 11px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--card);
		color: var(--muted-foreground);
		cursor: pointer;
		font-family: inherit;
	}
	.caps-reset-btn:hover:not(:disabled) {
		border-color: var(--primary);
		color: var(--primary);
	}
	.caps-reset-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.caps-hint {
		font-size: 11px;
		color: var(--muted-foreground);
		flex: 1;
	}
	.caps-group {
		margin-bottom: 12px;
	}
	.caps-group:last-child {
		margin-bottom: 0;
	}
	.caps-group-label {
		font-size: 10px;
		font-weight: 700;
		color: var(--primary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 6px;
	}
	.caps-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 8px;
		padding: 6px 0;
		font-size: 12px;
		cursor: pointer;
	}
	.caps-row input[type='checkbox']:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.caps-row-label {
		font-weight: 600;
		color: var(--foreground);
	}
	.caps-warn {
		font-size: 9px;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: 999px;
		background: #fef3c7;
		color: #92400e;
		margin-left: 4px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.caps-desc {
		font-size: 11px;
		color: var(--muted-foreground);
		grid-column: 2 / -1;
		font-weight: normal;
	}
</style>
