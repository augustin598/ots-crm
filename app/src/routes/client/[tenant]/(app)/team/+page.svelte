<script lang="ts">
	import { getClient } from '$lib/remotes/clients.remote';
	import { getClientSecondaryEmails } from '$lib/remotes/client-secondary-emails.remote';
	import { getTasks } from '$lib/remotes/tasks.remote';
	import ClientTeamPageHeader from '$lib/components/client-team/client-team-page-header.svelte';
	import ClientTeamHero from '$lib/components/client-team/client-team-hero.svelte';
	import ClientTeamStats from '$lib/components/client-team/client-team-stats.svelte';
	import ClientTeamRoleChips, {
		type RoleId
	} from '$lib/components/client-team/client-team-role-chips.svelte';
	import ClientTeamMemberCard from '$lib/components/client-team/client-team-member-card.svelte';
	import ClientTeamInviteModal from '$lib/components/client-team/client-team-invite-modal.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';

	let { data }: { data: { clientId: string; clientName: string; currentEmail: string } } = $props();

	const clientId = $derived(data.clientId);

	const clientQuery = $derived(clientId ? getClient(clientId) : null);
	const client = $derived(clientQuery?.current);

	const secondariesQuery = $derived(clientId ? getClientSecondaryEmails(clientId) : null);
	const secondaries = $derived(secondariesQuery?.current ?? []);

	const tasksQuery = $derived(getTasks({ clientId }));
	const tasks = $derived(tasksQuery.current ?? []);

	let search = $state('');
	let roleFilter = $state<RoleId>('all');
	let inviteOpen = $state(false);

	const ROLE_DEFS = [
		{ id: 'owner', label: 'Owner', color: '#dc2626', bg: '#fef2f2', description: 'Acces total' },
		{ id: 'admin', label: 'Admin', color: '#1877F2', bg: '#dbeafe', description: 'Gestionează membri și taskuri' },
		{ id: 'member', label: 'Member', color: '#10b981', bg: '#d1fae5', description: 'Vede + creează taskuri proprii' },
		{ id: 'viewer', label: 'Viewer', color: '#94a3b8', bg: '#f1f5f9', description: 'Doar citire' }
	] as const;

	type Member = {
		id: string;
		firstName: string | null;
		lastName: string | null;
		email: string | null;
		phone: string | null;
		title: string | null;
		role: string;
		addedAt: Date | string | null;
	};

	const members = $derived<Member[]>(
		secondaries.map((s: any) => ({
			id: s.userId ?? s.id,
			firstName: s.firstName ?? null,
			lastName: s.lastName ?? null,
			email: s.email ?? null,
			phone: s.phone ?? null,
			title: s.title ?? null,
			role: s.role ?? 'member',
			addedAt: s.createdAt ?? null
		}))
	);

	const filteredMembers = $derived.by(() => {
		let result = members;
		if (roleFilter !== 'all') {
			result = result.filter((m) => m.role === roleFilter);
		}
		if (search.trim()) {
			const q = search.trim().toLowerCase();
			result = result.filter((m) => {
				const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim().toLowerCase();
				return name.includes(q) || (m.email ?? '').toLowerCase().includes(q);
			});
		}
		return result;
	});

	const roleCounts = $derived.by(() => {
		const counts: Record<string, number> = { all: members.length };
		for (const r of ROLE_DEFS) {
			counts[r.id] = members.filter((m) => m.role === r.id).length;
		}
		return counts;
	});

	const roleChips = $derived([
		{ id: 'all' as const, label: 'Toți', color: '#94a3b8', count: roleCounts.all ?? members.length },
		...ROLE_DEFS.map((r) => ({
			id: r.id as RoleId,
			label: r.label,
			color: r.color,
			count: roleCounts[r.id] ?? 0
		}))
	]);

	const stats = $derived({
		total: members.length,
		online: 0,
		pending: tasks.filter((t: any) => t.status === 'pending-approval').length,
		openTasks: tasks.filter((t: any) => t.status !== 'done' && t.status !== 'cancelled').length
	});
</script>

<svelte:head>
	<title>Echipa · Client Portal</title>
</svelte:head>

<div class="cteam-wrap flex min-h-screen flex-col bg-[#f4f6fa]">
	<ClientTeamPageHeader
		clientName={client?.name ?? data.clientName ?? ''}
		{stats}
		{search}
		onSearchChange={(v) => (search = v)}
		onPermissionsClick={() => toast.info('Setarea permisiunilor va fi disponibilă în curând')}
		onInviteClick={() => (inviteOpen = true)}
	/>

	<ClientTeamHero onAddClick={() => (inviteOpen = true)} />

	<ClientTeamStats
		total={stats.total}
		online={stats.online}
		pending={stats.pending}
		openTasks={stats.openTasks}
	/>

	<ClientTeamRoleChips roles={roleChips} active={roleFilter} onChange={(r) => (roleFilter = r)} />

	<div class="cteam-body px-7 py-6">
		<div class="cteam-grid grid gap-3" style:grid-template-columns="repeat(auto-fill, minmax(300px, 1fr))">
			{#each filteredMembers as m (m.id)}
				{@const roleDef = ROLE_DEFS.find((r) => r.id === m.role) ?? ROLE_DEFS[2]}
				<ClientTeamMemberCard
					id={m.id}
					firstName={m.firstName}
					lastName={m.lastName}
					email={m.email}
					phone={m.phone}
					title={m.title}
					roleLabel={roleDef.label}
					roleColor={roleDef.color}
					roleBg={roleDef.bg}
					online={false}
					lastActive={null}
					addedAt={m.addedAt}
					onEmailClick={() => { if (m.email) window.location.href = `mailto:${m.email}`; }}
				/>
			{/each}

			<button
				type="button"
				class="cteam-add flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-[#d5dbe5] bg-transparent p-4 text-[#475569] transition-colors hover:border-[#1877F2] hover:bg-[#1877F2]/[0.04] hover:text-[#1877F2]"
				onclick={() => (inviteOpen = true)}
			>
				<div class="grid h-12 w-12 place-items-center rounded-full bg-[#f0f7ff] text-[#1877F2]">
					<PlusIcon class="h-6 w-6" />
				</div>
				<span class="text-[13px] font-semibold">Adaugă coleg</span>
				<span class="text-[11.5px] text-[#94a3b8]">Trimite invitație pe email</span>
			</button>
		</div>
	</div>
</div>

<ClientTeamInviteModal
	open={inviteOpen}
	{clientId}
	roles={ROLE_DEFS.map((r) => ({ id: r.id, label: r.label, description: r.description, color: r.color }))}
	onClose={() => (inviteOpen = false)}
/>
