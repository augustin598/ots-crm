<script lang="ts">
	import type { PageData } from './$types';
	import {
		sendInvitation,
		cancelInvitation,
		getInvitations
	} from '$lib/remotes/invitations.remote';
	import {
		updateTenantUserRole,
		updateTenantUserMeta,
		updateTenantUserSkills,
		removeTenantUser,
		suspendTenantUser,
		reactivateTenantUser,
		getTenantUsers
	} from '$lib/remotes/users.remote';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import SearchIcon from '@lucide/svelte/icons/search';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import {
		ADMIN_ROLES,
		ADMIN_PERMISSION_MATRIX,
		DEPARTMENTS,
		getAdminRole,
		getDepartment,
		type AdminRoleId,
		type DepartmentId
	} from '$lib/config/team';
	import TeamKpiStrip from '$lib/components/team/TeamKpiStrip.svelte';
	import TeamMemberCard from '$lib/components/team/TeamMemberCard.svelte';
	import TeamMemberTable from '$lib/components/team/TeamMemberTable.svelte';
	import TeamDeptLanes from '$lib/components/team/TeamDeptLanes.svelte';
	import TeamInviteModal from '$lib/components/team/TeamInviteModal.svelte';
	import TeamPendingInviteCard from '$lib/components/team/TeamPendingInviteCard.svelte';
	import TeamPendingBanner from '$lib/components/team/TeamPendingBanner.svelte';
	import TeamPermissionsMatrix from '$lib/components/team/TeamPermissionsMatrix.svelte';
	import TeamProfileModal, { type ProfileMember } from '$lib/components/team/TeamProfileModal.svelte';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import UsersIcon from '@lucide/svelte/icons/users';

	let { data }: { data: PageData } = $props();

	let view = $state<'grid' | 'table' | 'lanes'>('grid');
	let search = $state('');
	let deptFilter = $state<'all' | DepartmentId>('all');
	let roleFilter = $state<'all' | AdminRoleId>('all');
	let inviteOpen = $state(false);
	let permsOpen = $state(false);
	let pendingListOpen = $state(false);
	let profileOpen = $state(false);
	let editingId = $state<string | null>(null);

	type RawMember = (typeof data.members)[number];

	function parseSkills(raw: string | null | undefined): string[] {
		if (!raw) return [];
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
		} catch {
			return [];
		}
	}

	const activeMembers = $derived(data.members.filter((m) => m.status === 'active'));
	const suspendedMembers = $derived(data.members.filter((m) => m.status === 'suspended'));
	let showSuspended = $state(false);

	const filteredMembers = $derived.by(() => {
		const q = search.toLowerCase().trim();
		return activeMembers.filter((m) => {
			if (deptFilter !== 'all' && m.department !== deptFilter) return false;
			if (roleFilter !== 'all' && m.role !== roleFilter) return false;
			if (!q) return true;
			const fullName = `${m.firstName ?? ''} ${m.lastName ?? ''}`.toLowerCase();
			return (
				fullName.includes(q) ||
				m.email.toLowerCase().includes(q) ||
				(m.title ?? '').toLowerCase().includes(q) ||
				(getAdminRole(m.role)?.label ?? '').toLowerCase().includes(q)
			);
		});
	});

	const totalMembers = $derived(activeMembers.length);
	const recentlyAdded = $derived.by(() => {
		const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
		return activeMembers.filter((m) => new Date(m.joinedAt).getTime() >= cutoff).length;
	});
	const onlineCount = $derived(
		activeMembers.filter((m) => data.sessions[m.userId]?.online).length
	);
	const onlinePct = $derived(
		totalMembers > 0 ? Math.round((onlineCount / totalMembers) * 100) : 0
	);
	const pendingInvites = $derived(data.invitations.length);
	const expiredInvites = $derived.by(() => {
		const now = Date.now();
		return data.invitations.filter((i) => new Date(i.expiresAt).getTime() < now).length;
	});
	const totalActive = $derived(
		activeMembers.reduce((acc, m) => acc + (data.stats[m.userId]?.active ?? 0), 0)
	);
	const heavyWorkload = $derived(
		activeMembers.filter((m) => (data.stats[m.userId]?.active ?? 0) > 16).length
	);
	const onTimeAvg = $derived.by(() => {
		const vals = activeMembers
			.map((m) => data.stats[m.userId]?.onTimePct)
			.filter((v): v is number => typeof v === 'number');
		if (vals.length === 0) return null;
		return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
	});

	const dateFmt = new Intl.DateTimeFormat('ro-RO', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	function memberRoleMeta(role: string) {
		const r = getAdminRole(role) ?? ADMIN_ROLES[ADMIN_ROLES.length - 1];
		return { label: r.label, color: r.color, bg: r.bg };
	}

	function memberDeptMeta(department: string | null | undefined) {
		const d = getDepartment(department);
		return d ? { label: d.label, color: d.color } : null;
	}

	function isMemberOnline(userId: string): boolean {
		return data.sessions[userId]?.online ?? false;
	}

	function formatLastActive(userId: string): string {
		const sess = data.sessions[userId];
		if (!sess) return '—';
		if (sess.online) return 'Online';
		if (!sess.lastActiveAt) return '—';
		const diff = Date.now() - new Date(sess.lastActiveAt).getTime();
		if (diff < 0) return 'acum';
		const min = Math.floor(diff / 60_000);
		if (min < 1) return 'acum';
		if (min < 60) return `${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `${h}h`;
		const d = Math.floor(h / 24);
		if (d < 7) return `${d}z`;
		return `${Math.floor(d / 7)}săpt`;
	}

	function toCardData(m: RawMember) {
		const s = data.stats[m.userId];
		return {
			id: m.tenantUserId,
			email: m.email,
			firstName: m.firstName,
			lastName: m.lastName,
			title: m.title ?? null,
			phone: m.phone ?? null,
			role: memberRoleMeta(m.role),
			department: memberDeptMeta(m.department),
			stats: s ? { active: s.active, done: s.done, onTime: s.onTimePct } : null,
			joinedAtLabel: m.joinedAt ? dateFmt.format(new Date(m.joinedAt)) : null,
			isYou: m.userId === data.currentUserId,
			online: isMemberOnline(m.userId),
			skills: parseSkills(m.skills)
		};
	}

	const editingMember = $derived.by<ProfileMember | null>(() => {
		if (!editingId) return null;
		const m = data.members.find((x) => x.tenantUserId === editingId);
		if (!m) return null;
		const s = data.stats[m.userId];
		return {
			tenantUserId: m.tenantUserId,
			userId: m.userId,
			email: m.email,
			firstName: m.firstName,
			lastName: m.lastName,
			title: m.title ?? null,
			phone: m.phone ?? null,
			role: m.role,
			department: m.department ?? null,
			skills: parseSkills(m.skills),
			hourlyRate: m.hourlyRate ?? null,
			status: (m.status as 'active' | 'suspended') ?? 'active',
			joinedAt: m.joinedAt ?? null,
			isYou: m.userId === data.currentUserId,
			isOwner: m.role === 'owner',
			online: isMemberOnline(m.userId),
			stats: s ? { active: s.active, done: s.done, onTime: s.onTimePct } : null
		};
	});

	function openProfile(m: RawMember) {
		editingId = m.tenantUserId;
		profileOpen = true;
	}

	$effect(() => {
		if (!profileOpen) editingId = null;
	});

	async function submitInvite({
		email,
		role,
		department,
		jobTitle
	}: {
		email: string;
		role: AdminRoleId;
		department?: DepartmentId | null;
		jobTitle?: string;
	}) {
		const safeRole = role === 'owner' ? 'admin' : role;
		await sendInvitation({
			email,
			role: safeRole,
			department: department ?? null,
			title: jobTitle ?? null
		});
		await invalidateAll();
		await getInvitations().refresh?.();
		toast.success(`Invitație trimisă către ${email}.`);
	}

	async function handleCancelInvite(id: string, email: string) {
		if (!confirm(`Anulezi invitația pentru ${email}?`)) return;
		try {
			await cancelInvitation(id);
			await invalidateAll();
			toast.success('Invitație anulată.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la anulare.');
		}
	}

	async function handleChangeRole(newRole: AdminRoleId) {
		const m = editingMember;
		if (!m) return;
		if (newRole === 'owner') {
			toast.error('Promovarea la Owner se face prin Transfer Ownership (urmează în v2).');
			return;
		}
		try {
			await updateTenantUserRole({ tenantUserId: m.tenantUserId, role: newRole });
			await invalidateAll();
			toast.success('Rol actualizat.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizare.');
		}
	}

	async function handleSaveMeta(patch: {
		department?: DepartmentId | null;
		title?: string | null;
		hourlyRate?: string | null;
	}) {
		const m = editingMember;
		if (!m) return;
		try {
			await updateTenantUserMeta({ tenantUserId: m.tenantUserId, ...patch });
			await invalidateAll();
			toast.success('Profil actualizat.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizare.');
		}
	}

	async function handleSaveSkills(skills: string[]) {
		const m = editingMember;
		if (!m) return;
		try {
			await updateTenantUserSkills({ tenantUserId: m.tenantUserId, skills });
			await invalidateAll();
			toast.success('Skills actualizate.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizare.');
		}
	}

	async function handleRemove() {
		const m = editingMember;
		if (!m) return;
		if (!confirm(`Sigur scoți ${m.email} din echipă?`)) return;
		try {
			await removeTenantUser({ tenantUserId: m.tenantUserId });
			await invalidateAll();
			await getTenantUsers().refresh?.();
			toast.success('Membru scos din echipă.');
			profileOpen = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la eliminare.');
		}
	}

	async function handleSuspend() {
		const m = editingMember;
		if (!m) return;
		if (!confirm(`Suspenzi contul ${m.email}? Va pierde accesul imediat.`)) return;
		try {
			await suspendTenantUser({ tenantUserId: m.tenantUserId });
			await invalidateAll();
			toast.success('Cont suspendat.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la suspendare.');
		}
	}

	async function handleReactivate() {
		const m = editingMember;
		if (!m) return;
		try {
			await reactivateTenantUser({ tenantUserId: m.tenantUserId });
			await invalidateAll();
			toast.success('Cont reactivat.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la reactivare.');
		}
	}

	function isExpired(d: Date | string): boolean {
		return new Date(d).getTime() < Date.now();
	}

	function exportCsv() {
		const rows = [
			[
				'Email',
				'Nume',
				'Rol',
				'Departament',
				'Titlu',
				'Tasks active',
				'Tasks done',
				'On-time',
				'Online',
				'Skills',
				'Rate',
				'Status',
				'Adăugat'
			]
		];
		for (const m of data.members) {
			const s = data.stats[m.userId];
			const dept = getDepartment(m.department);
			const skills = parseSkills(m.skills).join(' / ');
			const sess = data.sessions[m.userId];
			rows.push([
				m.email,
				`${m.firstName ?? ''} ${m.lastName ?? ''}`.trim(),
				getAdminRole(m.role)?.label ?? m.role,
				dept?.label ?? '',
				m.title ?? '',
				String(s?.active ?? 0),
				String(s?.done ?? 0),
				s?.onTimePct !== null && s?.onTimePct !== undefined ? `${s.onTimePct}%` : '—',
				sess?.online ? 'Online' : 'Offline',
				skills,
				m.hourlyRate ?? '',
				m.status === 'suspended' ? 'Suspendat' : 'Activ',
				m.joinedAt ? dateFmt.format(new Date(m.joinedAt)) : ''
			]);
		}
		const csv = rows
			.map((r) =>
				r
					.map((cell) => {
						const c = String(cell);
						return /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
					})
					.join(',')
			)
			.join('\n');
		const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `team-${new Date().toISOString().slice(0, 10)}.csv`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
		toast.success(`Export CSV cu ${data.members.length} membri.`);
	}
</script>

<div class="space-y-5">
	<!-- Header -->
	<div class="flex items-end justify-between gap-4 flex-wrap">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Team</h1>
			<p class="text-sm text-muted-foreground mt-1">
				{totalMembers} membri · {onlineCount} online · {pendingInvites} invitații în așteptare
			</p>
		</div>
		<div class="flex items-center gap-2 flex-wrap">
			<div class="relative">
				<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
				<Input
					bind:value={search}
					placeholder="Caută membru, email, rol..."
					class="pl-9 w-[280px]"
				/>
			</div>
			<Button variant="outline" onclick={() => (permsOpen = true)}>
				<LayersIcon class="mr-2 size-4" />
				Permisiuni
			</Button>
			<Button variant="outline" onclick={exportCsv}>
				<DownloadIcon class="mr-2 size-4" />
				Export
			</Button>
			<Button onclick={() => (inviteOpen = true)}>
				<PlusIcon class="mr-2 size-4" />
				Invită membru
			</Button>
		</div>
	</div>

	<!-- KPIs (5 carduri) -->
	<TeamKpiStrip
		items={[
			{
				label: 'Total membri',
				value: totalMembers,
				foot:
					recentlyAdded > 0
						? `${recentlyAdded} ${recentlyAdded === 1 ? 'nou' : 'noi'} ultimele 30 zile`
						: 'fără adăugări recente',
				delta: recentlyAdded > 0 ? { text: `+${recentlyAdded}` } : null
			},
			{
				label: 'Online acum',
				value: onlineCount,
				foot: `${onlinePct}% din echipă`,
				tone: onlineCount > 0 ? 'success' : 'default'
			},
			{
				label: 'Tasks active',
				value: totalActive,
				foot:
					totalMembers > 0
						? `≈ ${Math.round(totalActive / totalMembers)} per persoană`
						: '—'
			},
			{
				label: 'Workload heavy',
				value: heavyWorkload,
				foot: heavyWorkload > 0 ? 'Necesită balansare' : 'Echipă în echilibru',
				tone: heavyWorkload > 0 ? 'warning' : 'success'
			},
			{
				label: 'On-time avg',
				value: onTimeAvg !== null ? `${onTimeAvg}%` : '—',
				foot: onTimeAvg !== null ? 'din taskurile finalizate' : 'fără date',
				tone: onTimeAvg !== null ? (onTimeAvg >= 90 ? 'success' : 'warning') : 'default'
			}
		]}
	/>

	<!-- Pending invites banner -->
	<TeamPendingBanner
		count={pendingInvites}
		emails={data.invitations.map((i) => i.email)}
		expiredCount={expiredInvites}
		onview={() => (pendingListOpen = true)}
	/>

	<!-- Filter bar: department chips + role dropdown + view toggle -->
	<div class="flex items-center gap-2 flex-wrap">
		<button
			type="button"
			class="chip"
			class:active={deptFilter === 'all'}
			onclick={() => (deptFilter = 'all')}
		>
			Toate <span class="count">{activeMembers.length}</span>
		</button>
		{#each DEPARTMENTS as d (d.id)}
			{@const c = activeMembers.filter((m) => m.department === d.id).length}
			{#if c > 0}
				<button
					type="button"
					class="chip"
					class:active={deptFilter === d.id}
					style:--chip-color={d.color}
					onclick={() => (deptFilter = d.id)}
				>
					<span class="dot" style="background:{d.color}"></span>
					{d.label} <span class="count">{c}</span>
				</button>
			{/if}
		{/each}
		<div class="divider"></div>
		<select
			class="role-select"
			bind:value={roleFilter}
			aria-label="Filtru rol"
		>
			<option value="all">Toate rolurile</option>
			{#each ADMIN_ROLES as r (r.id)}
				<option value={r.id}>{r.label}</option>
			{/each}
		</select>
		<div class="ml-auto flex gap-1 bg-muted p-1 rounded-lg">
			<button
				type="button"
				class="view-btn"
				class:active={view === 'grid'}
				onclick={() => (view = 'grid')}
			>
				<LayoutGridIcon class="size-3" /> Grid
			</button>
			<button
				type="button"
				class="view-btn"
				class:active={view === 'table'}
				onclick={() => (view = 'table')}
			>
				<ListIcon class="size-3" /> Tabel
			</button>
			<button
				type="button"
				class="view-btn"
				class:active={view === 'lanes'}
				onclick={() => (view = 'lanes')}
			>
				<UsersIcon class="size-3" /> Departamente
			</button>
		</div>
	</div>

	<!-- Members grid/table/lanes -->
	{#if filteredMembers.length === 0}
		<div class="empty-state">
			Niciun membru găsit. Schimbă filtrul sau
			<button
				class="text-primary font-semibold underline"
				onclick={() => (inviteOpen = true)}
			>
				invită unul nou
			</button>.
		</div>
	{:else if view === 'grid'}
		<div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
			{#each filteredMembers as m (m.tenantUserId)}
				<TeamMemberCard member={toCardData(m)} onclick={() => openProfile(m)} />
			{/each}
		</div>
	{:else if view === 'table'}
		<TeamMemberTable
			members={filteredMembers.map(toCardData)}
			onpick={(c) => {
				const m = filteredMembers.find((x) => x.tenantUserId === c.id);
				if (m) openProfile(m);
			}}
			formatLastActive={(c) => {
				const m = data.members.find((x) => x.tenantUserId === c.id);
				return m ? formatLastActive(m.userId) : '—';
			}}
		/>
	{:else}
		<TeamDeptLanes
			members={filteredMembers.map(toCardData)}
			onpick={(c) => {
				const m = filteredMembers.find((x) => x.tenantUserId === c.id);
				if (m) openProfile(m);
			}}
		/>
	{/if}

	<!-- Suspended members section -->
	{#if suspendedMembers.length > 0}
		<div class="suspended-section">
			<button
				type="button"
				class="suspended-toggle"
				onclick={() => (showSuspended = !showSuspended)}
			>
				{showSuspended ? '▼' : '▶'} Membri suspendați ({suspendedMembers.length})
			</button>
			{#if showSuspended}
				<div class="grid gap-3 mt-3" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
					{#each suspendedMembers as m (m.tenantUserId)}
						<div class="suspended-wrap">
							<TeamMemberCard member={toCardData(m)} onclick={() => openProfile(m)} />
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Invite modal -->
<TeamInviteModal
	bind:open={inviteOpen}
	title="Invită membru nou"
	description="Persoana va primi un email cu link de activare. Link-ul expiră în 7 zile."
	roles={ADMIN_ROLES.filter((r) => r.id !== 'owner')}
	defaultRole={'member' as AdminRoleId}
	departments={DEPARTMENTS}
	defaultDepartment={'ads' as DepartmentId}
	showTitle
	showWelcomeMessage
	submit={submitInvite}
/>

<!-- Permissions modal -->
<Dialog.Root bind:open={permsOpen}>
	<Dialog.Content class="sm:max-w-[820px]">
		<Dialog.Header>
			<Dialog.Title>Roluri & Permisiuni</Dialog.Title>
			<Dialog.Description>
				Permisiunile se acumulează — Owner are tot, Member doar acces standard.
			</Dialog.Description>
		</Dialog.Header>
		<TeamPermissionsMatrix roles={ADMIN_ROLES} permissions={ADMIN_PERMISSION_MATRIX} />
		<Dialog.Footer>
			<Button onclick={() => (permsOpen = false)}>Închide</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Pending invites detail modal -->
<Dialog.Root bind:open={pendingListOpen}>
	<Dialog.Content class="sm:max-w-[640px]">
		<Dialog.Header>
			<Dialog.Title>Invitații în așteptare</Dialog.Title>
			<Dialog.Description>
				{pendingInvites} invitații{#if expiredInvites > 0}, {expiredInvites} expirate{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
			{#each data.invitations as inv (inv.id)}
				<TeamPendingInviteCard
					invite={{
						id: inv.id,
						email: inv.email,
						role: memberRoleMeta(inv.role),
						expiresAtLabel: inv.expiresAt ? dateFmt.format(new Date(inv.expiresAt)) : null,
						isExpired: isExpired(inv.expiresAt)
					}}
					oncancel={() => handleCancelInvite(inv.id, inv.email)}
				/>
			{/each}
		</div>
		<Dialog.Footer>
			<Button onclick={() => (pendingListOpen = false)}>Închide</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Profile modal -->
<TeamProfileModal
	bind:open={profileOpen}
	member={editingMember}
	actorRole={data.currentRole as AdminRoleId}
	onChangeRole={handleChangeRole}
	onSaveMeta={handleSaveMeta}
	onSaveSkills={handleSaveSkills}
	onRemove={handleRemove}
	onSuspend={handleSuspend}
	onReactivate={handleReactivate}
/>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		border: 1px solid var(--border);
		background: var(--card);
		color: var(--muted-foreground);
		cursor: pointer;
		font-family: inherit;
	}
	.chip:hover {
		border-color: var(--primary);
		color: var(--primary);
	}
	.chip.active {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--primary-foreground);
	}
	.chip .dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.chip .count {
		background: rgba(255, 255, 255, 0.25);
		padding: 1px 6px;
		border-radius: 999px;
		font-size: 10.5px;
	}
	.chip:not(.active) .count {
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.divider {
		width: 1px;
		height: 22px;
		background: var(--border);
		margin: 0 4px;
	}
	.role-select {
		padding: 5px 28px 5px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 12px;
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
	.role-select:focus {
		outline: none;
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.view-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		border-radius: 6px;
		border: none;
		background: transparent;
		font-size: 12px;
		font-weight: 600;
		color: var(--muted-foreground);
		cursor: pointer;
		font-family: inherit;
	}
	.view-btn.active {
		background: var(--card);
		color: var(--foreground);
		box-shadow: 0 1px 2px color-mix(in oklch, var(--foreground) 8%, transparent);
	}
	.empty-state {
		border: 1px dashed var(--border);
		background: color-mix(in oklch, var(--foreground) 2%, transparent);
		border-radius: 12px;
		padding: 60px;
		text-align: center;
		color: var(--muted-foreground);
		font-size: 13px;
	}
	.suspended-section {
		margin-top: 24px;
		padding-top: 20px;
		border-top: 1px dashed var(--border);
	}
	.suspended-toggle {
		background: none;
		border: none;
		color: var(--muted-foreground);
		font-weight: 700;
		font-size: 12.5px;
		cursor: pointer;
		font-family: inherit;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 4px 0;
	}
	.suspended-wrap {
		opacity: 0.55;
		filter: grayscale(0.4);
	}
</style>
