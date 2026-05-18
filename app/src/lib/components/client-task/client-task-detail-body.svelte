<!-- src/lib/components/client-task/client-task-detail-body.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import { getTenantUsers, getClientUsers } from '$lib/remotes/users.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ClientTaskPageHead from './client-task-page-head.svelte';
	import ClientTaskDescription from './client-task-description.svelte';
	import ClientTaskComments from './client-task-comments.svelte';
	import ClientTaskRail from './client-task-rail.svelte';
	import ClientTaskMeetModal from './client-task-meet-modal.svelte';
	import ClientTaskLightbox, { type LightboxImage } from './client-task-lightbox.svelte';

	type TaskWithIncludes = Task & {
		subtasks?: any[];
		tags?: any[];
		assignees?: any[];
	};

	type Props = {
		task: TaskWithIncludes | null;
		currentUserId: string;
		tenantSlug: string;
		onClose: () => void;
	};

	let { task, currentUserId, tenantSlug, onClose }: Props = $props();

	const tenantUsersQuery = getTenantUsers();
	const tenantUsers = $derived(tenantUsersQuery.current ?? []);

	const clientUsersQuery = $derived(task?.clientId ? getClientUsers(task.clientId) : null);
	const clientUsers = $derived(clientUsersQuery?.current ?? []);

	const clientQuery = $derived(task?.clientId ? getClient(task.clientId) : null);
	const client = $derived(clientQuery?.current);

	const createdByName = $derived.by(() => {
		if (!task?.createdByUserId) return null;
		const u = tenantUsers.find((x: any) => x.id === task.createdByUserId);
		if (!u) return null;
		const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
		return full || u.email;
	});

	let meetOpen = $state(false);
	let lbOpen = $state(false);
	let lbImages = $state<LightboxImage[]>([]);
	let lbIndex = $state(0);

	function openLightbox(images: LightboxImage[], startIndex: number) {
		lbImages = images;
		lbIndex = startIndex;
		lbOpen = true;
	}

	// Body-scroll lock when any modal is open
	$effect(() => {
		const anyModalOpen = meetOpen || lbOpen;
		if (typeof document === 'undefined') return;
		if (anyModalOpen) {
			const prev = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = prev;
			};
		}
	});

	const allInvitees = $derived([
		...tenantUsers.map((u: any) => ({
			id: u.id,
			firstName: u.firstName,
			lastName: u.lastName,
			email: u.email
		})),
		...clientUsers.map((u: any) => ({
			id: u.id,
			firstName: u.firstName,
			lastName: u.lastName,
			email: u.email
		}))
	]);
</script>

{#if task}
	<div class="client-shell flex min-h-screen bg-[#f5f7fa]">
		<div class="client-main flex-1 flex flex-col">
			<!-- Topbar with breadcrumbs -->
			<div class="client-topbar flex items-center gap-2 border-b border-[#e5e9f0] bg-white px-7 py-3.5 text-[13px] text-[#64748b]">
				<a href="/client/{tenantSlug}/settings" class="client-crumb inline-flex items-center gap-1.5 hover:text-[#0f172a]">
					<SettingsIcon class="h-3.5 w-3.5" />
				</a>
				<ChevronRightIcon class="h-3 w-3 text-[#cbd5e1]" />
				<a href="/client/{tenantSlug}/tasks" class="client-crumb hover:text-[#0f172a]">Tasks</a>
				<ChevronRightIcon class="h-3 w-3 text-[#cbd5e1]" />
				<span class="client-crumb current truncate font-semibold text-[#0f172a]">{task.title}</span>
			</div>

			<!-- Page body -->
			<div class="client-task-page mx-auto grid w-full max-w-[1280px] gap-6 p-7" style:grid-template-columns="1fr 320px">
				<div class="flex min-w-0 flex-col gap-5">
					<ClientTaskPageHead
						{task}
						clientName={client?.name ?? null}
						tags={task.tags ?? []}
						onBack={onClose}
						onScheduleMeet={() => (meetOpen = true)}
					/>
					<ClientTaskDescription description={task.description} />
					<ClientTaskComments
						taskId={task.id}
						onOpenLightbox={openLightbox}
					/>
				</div>

				<ClientTaskRail
					{task}
					subtasks={task.subtasks ?? []}
					assignees={task.assignees ?? []}
					{createdByName}
					readonlyTeam={true}
					onOpenLightbox={openLightbox}
				/>
			</div>
		</div>
	</div>

	<ClientTaskMeetModal
		open={meetOpen}
		taskId={task.id}
		taskTitle={task.title}
		availableInvitees={allInvitees}
		defaultInviteeIds={(task.assignees ?? []).map((a: any) => a.id)}
		onClose={() => (meetOpen = false)}
	/>

	<ClientTaskLightbox
		images={lbImages}
		index={lbIndex}
		open={lbOpen}
		onClose={() => (lbOpen = false)}
		onIndexChange={(i) => (lbIndex = i)}
	/>
{:else}
	<div class="flex h-full items-center justify-center p-8">
		<p class="text-[#94a3b8] text-sm">Se încarcă...</p>
	</div>
{/if}
