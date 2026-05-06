<script lang="ts">
	import type { PageData } from './$types';
	import {
		sendInvitation,
		cancelInvitation,
		getInvitations
	} from '$lib/remotes/invitations.remote';
	import {
		updateTenantUserRole,
		removeTenantUser,
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
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import {
		ADMIN_ROLES,
		ADMIN_PERMISSION_MATRIX,
		getAdminRole,
		type AdminRoleId
	} from '$lib/config/team';
	import TeamKpiStrip from '$lib/components/team/TeamKpiStrip.svelte';
	import TeamMemberCard from '$lib/components/team/TeamMemberCard.svelte';
	import TeamMemberTable from '$lib/components/team/TeamMemberTable.svelte';
	import TeamInviteModal from '$lib/components/team/TeamInviteModal.svelte';
	import TeamPendingInviteCard from '$lib/components/team/TeamPendingInviteCard.svelte';
	import TeamPermissionsMatrix from '$lib/components/team/TeamPermissionsMatrix.svelte';
	import TeamRoleGrid from '$lib/components/team/TeamRoleGrid.svelte';

	let { data }: { data: PageData } = $props();

	let view = $state<'grid' | 'table'>('grid');
	let search = $state('');
	let roleFilter = $state<'all' | AdminRoleId>('all');
	let inviteOpen = $state(false);
	let permsOpen = $state(false);
	let editing = $state<null | (typeof data.members)[number]>(null);

	const filteredMembers = $derived.by(() => {
		const q = search.toLowerCase().trim();
		return data.members.filter((m) => {
			if (roleFilter !== 'all' && m.role !== roleFilter) return false;
			if (!q) return true;
			const fullName = `${m.firstName ?? ''} ${m.lastName ?? ''}`.toLowerCase();
			return fullName.includes(q) || m.email.toLowerCase().includes(q);
		});
	});

	const totalMembers = $derived(data.members.length);
	const recentlyAdded = $derived.by(() => {
		const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
		return data.members.filter((m) => new Date(m.joinedAt).getTime() >= cutoff).length;
	});
	const pendingInvites = $derived(data.invitations.length);
	const expiredInvites = $derived.by(() => {
		const now = Date.now();
		return data.invitations.filter((i) => new Date(i.expiresAt).getTime() < now).length;
	});

	const dateFmt = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });

	function memberRoleMeta(role: string) {
		const r = getAdminRole(role) ?? ADMIN_ROLES[ADMIN_ROLES.length - 1];
		return { label: r.label, color: r.color, bg: r.bg };
	}

	function toCardData(m: (typeof data.members)[number]) {
		return {
			id: m.tenantUserId,
			email: m.email,
			firstName: m.firstName,
			lastName: m.lastName,
			role: memberRoleMeta(m.role),
			joinedAtLabel: m.joinedAt ? dateFmt.format(new Date(m.joinedAt)) : null,
			isYou: m.userId === data.currentUserId
		};
	}

	function openProfile(m: (typeof data.members)[number]) {
		editing = m;
	}

	async function submitInvite({ email, role }: { email: string; role: AdminRoleId }) {
		await sendInvitation({ email, role: role === 'owner' ? 'admin' : role });
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

	async function handleChangeRole(member: NonNullable<typeof editing>, newRole: AdminRoleId) {
		if (newRole === 'owner') {
			toast.error('Promovarea la Owner se face prin Transfer Ownership (urmează în v2).');
			return;
		}
		try {
			await updateTenantUserRole({ tenantUserId: member.tenantUserId, role: newRole });
			await invalidateAll();
			toast.success('Rol actualizat.');
			editing = null;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizare.');
		}
	}

	async function handleRemove(member: NonNullable<typeof editing>) {
		if (!confirm(`Sigur scoți ${member.email} din echipă?`)) return;
		try {
			await removeTenantUser({ tenantUserId: member.tenantUserId });
			await invalidateAll();
			await getTenantUsers().refresh?.();
			toast.success('Membru scos din echipă.');
			editing = null;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la eliminare.');
		}
	}

	function isExpired(d: Date | string): boolean {
		return new Date(d).getTime() < Date.now();
	}
</script>

<div class="space-y-5">
	<!-- Header -->
	<div class="flex items-end justify-between gap-4 flex-wrap">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Team</h1>
			<p class="text-sm text-muted-foreground mt-1">
				{totalMembers} membri · {pendingInvites} invitații în așteptare
			</p>
		</div>
		<div class="flex items-center gap-2 flex-wrap">
			<div class="relative">
				<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
				<Input bind:value={search} placeholder="Caută membru, email..." class="pl-9 w-[260px]" />
			</div>
			<Button variant="outline" onclick={() => (permsOpen = true)}>
				<LayersIcon class="mr-2 size-4" />
				Permisiuni
			</Button>
			<Button onclick={() => (inviteOpen = true)}>
				<PlusIcon class="mr-2 size-4" />
				Invită membru
			</Button>
		</div>
	</div>

	<!-- KPIs -->
	<TeamKpiStrip
		items={[
			{
				label: 'Total membri',
				value: totalMembers,
				foot: `${recentlyAdded} adăugați ultimele 30 zile`
			},
			{
				label: 'Invitații pending',
				value: pendingInvites,
				foot:
					expiredInvites > 0
						? `${expiredInvites} expirate`
						: 'Niciuna expirată',
				tone: expiredInvites > 0 ? 'warning' : 'default'
			},
			{
				label: 'Adăugați recent',
				value: recentlyAdded,
				foot: 'în ultimele 30 zile'
			}
		]}
	/>

	<!-- Filter + view -->
	<div class="flex items-center gap-2 flex-wrap">
		<button
			type="button"
			class="chip"
			class:active={roleFilter === 'all'}
			onclick={() => (roleFilter = 'all')}
		>
			Toți <span class="count">{totalMembers}</span>
		</button>
		{#each ADMIN_ROLES as r (r.id)}
			{@const c = data.members.filter((m) => m.role === r.id).length}
			{#if c > 0}
				<button
					type="button"
					class="chip"
					class:active={roleFilter === r.id}
					onclick={() => (roleFilter = r.id)}
				>
					<span class="dot" style="background:{r.color}"></span>
					{r.label} <span class="count">{c}</span>
				</button>
			{/if}
		{/each}
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
		</div>
	</div>

	<!-- Pending invites banner -->
	{#if pendingInvites > 0}
		<div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
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
	{/if}

	<!-- Members grid/table -->
	{#if filteredMembers.length === 0}
		<div class="rounded-lg border border-dashed bg-muted/20 p-12 text-center text-muted-foreground">
			Niciun membru găsit. Schimbă filtrul sau
			<button class="text-primary font-semibold underline" onclick={() => (inviteOpen = true)}>
				invită unul nou
			</button>.
		</div>
	{:else if view === 'grid'}
		<div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
			{#each filteredMembers as m (m.tenantUserId)}
				<TeamMemberCard member={toCardData(m)} onclick={() => openProfile(m)} />
			{/each}
		</div>
	{:else}
		<TeamMemberTable members={filteredMembers.map(toCardData)} onpick={(c) => {
			const m = filteredMembers.find(x => x.tenantUserId === c.id);
			if (m) openProfile(m);
		}} />
	{/if}
</div>

<!-- Invite modal -->
<TeamInviteModal
	bind:open={inviteOpen}
	title="Invită membru"
	description="Persoana va primi un email cu link de activare. Link-ul expiră în 7 zile."
	roles={ADMIN_ROLES.filter((r) => r.id !== 'owner')}
	defaultRole={'member' as AdminRoleId}
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

<!-- Profile / role-changer modal -->
{#if editing}
	{@const member = editing}
	{@const isOwner = member.role === 'owner'}
	{@const isSelf = member.userId === data.currentUserId}
	{@const canActorChangeRole = data.currentRole === 'owner' && !isSelf && !isOwner}
	{@const canActorRemove = (data.currentRole === 'owner' || data.currentRole === 'admin') && !isSelf && !isOwner}
	<Dialog.Root open={true} onOpenChange={(v) => { if (!v) editing = null; }}>
		<Dialog.Content class="sm:max-w-[640px]">
			<Dialog.Header>
				<Dialog.Title>Profil membru</Dialog.Title>
			</Dialog.Header>
			<div class="space-y-4">
				<TeamMemberCard member={toCardData(member)} />
				<div class="space-y-2">
					<div class="text-sm font-semibold">Rol</div>
					{#if canActorChangeRole}
						<TeamRoleGrid
							roles={ADMIN_ROLES.filter((r) => r.id !== 'owner')}
							value={member.role === 'owner' ? 'admin' : (member.role as AdminRoleId)}
							disabled={!canActorChangeRole}
						/>
						<div class="text-xs text-muted-foreground">
							Click pe un rol pentru a-l aplica imediat.
						</div>
						<div class="flex gap-2 pt-2">
							{#each ADMIN_ROLES.filter((r) => r.id !== 'owner') as r (r.id)}
								<Button
									size="sm"
									variant={member.role === r.id ? 'default' : 'outline'}
									onclick={() => handleChangeRole(member, r.id)}
									disabled={member.role === r.id}
								>
									{r.label}
								</Button>
							{/each}
						</div>
					{:else}
						<div class="text-xs text-muted-foreground">
							{#if isSelf}
								Nu îți poți modifica propriul rol. Folosește <strong>Transfer Ownership</strong> (urmează în v2).
							{:else if isOwner}
								Owner-ul nu poate fi schimbat de aici. Folosește <strong>Transfer Ownership</strong> (urmează în v2).
							{:else}
								Doar Owner-ul poate schimba roluri.
							{/if}
						</div>
					{/if}
				</div>
			</div>
			<Dialog.Footer>
				{#if canActorRemove}
					<Button
						variant="ghost"
						class="text-destructive border-destructive/30 mr-auto"
						onclick={() => handleRemove(member)}
					>
						<TrashIcon class="size-4 mr-1" /> Scoate din echipă
					</Button>
				{/if}
				<Button onclick={() => (editing = null)}>Închide</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}

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
</style>
