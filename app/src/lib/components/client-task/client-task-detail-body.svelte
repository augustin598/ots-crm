<!-- src/lib/components/client-task/client-task-detail-body.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import { getTenantUsers, getClientUsers } from '$lib/remotes/users.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ClientTaskPageHead from './client-task-page-head.svelte';
	import ClientTaskPills from './client-task-pills.svelte';
	import ClientTaskDescription from './client-task-description.svelte';
	import ClientTaskComments from './client-task-comments.svelte';
	import ClientTaskRail from './client-task-rail.svelte';
	import type ClientTaskMeetModalType from './client-task-meet-modal.svelte';
	import type ClientTaskLightboxType from './client-task-lightbox.svelte';

	// Inline type (mirrors the export in client-task-lightbox.svelte — safe to duplicate as types are erased at runtime)
	type LightboxImage = { url: string; name?: string };

	type TaskWithIncludes = Task & {
		subtasks?: any[];
		tags?: any[];
		assignees?: any[];
	};

	type Props = {
		task: TaskWithIncludes | null;
		tenantSlug: string;
		onClose: () => void;
	};

	let { task, tenantSlug, onClose }: Props = $props();

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

	let MeetModalComp = $state<typeof ClientTaskMeetModalType | null>(null);
	let LightboxComp = $state<typeof ClientTaskLightboxType | null>(null);

	let meetOpen = $state(false);
	let lbOpen = $state(false);
	let lbImages = $state<LightboxImage[]>([]);
	let lbIndex = $state(0);

	async function openMeet() {
		if (!MeetModalComp) {
			const module = await import('./client-task-meet-modal.svelte');
			MeetModalComp = module.default;
		}
		meetOpen = true;
	}

	async function openLightbox(images: LightboxImage[], startIndex: number) {
		if (!LightboxComp) {
			const module = await import('./client-task-lightbox.svelte');
			LightboxComp = module.default;
		}
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
		<div class="client-main flex flex-1 flex-col">
			<!-- Topbar with breadcrumbs -->
			<div
				class="client-topbar flex items-center gap-2 border-b border-[#e5e9f0] bg-white px-7 py-3.5 text-[13px] text-[#64748b]"
			>
				<a
					href="/client/{tenantSlug}/settings"
					class="client-crumb inline-flex items-center gap-1.5 hover:text-[#1877F2]"
				>
					<SettingsIcon class="h-3.5 w-3.5" />
				</a>
				<ChevronRightIcon class="h-3 w-3 text-[#cbd5e1]" />
				<a href="/client/{tenantSlug}/tasks" class="client-crumb hover:text-[#1877F2]">Tasks</a>
				<ChevronRightIcon class="h-3 w-3 text-[#cbd5e1]" />
				<span class="client-crumb current truncate font-semibold text-[#0f172a]">{task.title}</span>
			</div>

			<!-- Page body -->
			<div
				class="client-task-page mx-auto grid w-full max-w-[1280px] gap-6 p-7"
				style:grid-template-columns="1fr 320px"
			>
				<div class="flex min-w-0 flex-col">
					<ClientTaskPageHead
						clientName={client?.name ?? null}
						onBack={onClose}
						onScheduleMeet={openMeet}
					/>

					<!-- Main white card containing title + pills + description + comments -->
					<div class="ct-main rounded-[14px] border border-[#e5e9f0] bg-white p-7">
						<h1
							class="ct-title m-0 mb-3.5 text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-[#0f172a]"
						>
							{task.title}
						</h1>

						<ClientTaskPills {task} tags={task.tags ?? []} />

						<ClientTaskDescription description={task.description} />

						<div class="ct-section mt-[26px]">
							<ClientTaskComments taskId={task.id} onOpenLightbox={openLightbox} />
						</div>
					</div>
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

	{#if MeetModalComp && meetOpen}
		<MeetModalComp
			open={meetOpen}
			taskId={task.id}
			taskTitle={task.title}
			availableInvitees={allInvitees}
			defaultInviteeIds={(task.assignees ?? []).map((a: any) => a.userId)}
			onClose={() => (meetOpen = false)}
		/>
	{/if}

	{#if LightboxComp && lbOpen}
		<LightboxComp
			images={lbImages}
			index={lbIndex}
			open={lbOpen}
			onClose={() => (lbOpen = false)}
			onIndexChange={(i) => (lbIndex = i)}
		/>
	{/if}
{:else}
	<div class="client-shell flex min-h-screen bg-[#f5f7fa]">
		<div class="client-main flex flex-1 animate-pulse flex-col">
			<!-- Breadcrumb skeleton -->
			<div class="border-b border-[#e5e9f0] bg-white px-7 py-3.5">
				<div class="flex items-center gap-2">
					<div class="h-3.5 w-3.5 rounded bg-[#e5e9f0]"></div>
					<div class="h-3 w-3 rounded bg-[#cbd5e1]"></div>
					<div class="h-3 w-16 rounded bg-[#e5e9f0]"></div>
					<div class="h-3 w-3 rounded bg-[#cbd5e1]"></div>
					<div class="h-3 w-24 rounded bg-[#e5e9f0]"></div>
				</div>
			</div>
			<div
				class="mx-auto grid w-full max-w-[1280px] gap-6 p-7"
				style:grid-template-columns="1fr 320px"
			>
				<div class="flex min-w-0 flex-col gap-3.5">
					<!-- Page head skeleton -->
					<div class="flex items-center justify-between">
						<div class="h-3 w-36 rounded bg-[#e5e9f0]"></div>
						<div class="flex gap-2">
							<div class="h-8 w-44 rounded-lg bg-[#e5e9f0]"></div>
							<div class="h-8 w-28 rounded-lg bg-[#e5e9f0]"></div>
						</div>
					</div>
					<!-- Main card skeleton -->
					<div class="space-y-4 rounded-[14px] border border-[#e5e9f0] bg-white p-7">
						<div class="h-8 w-3/4 rounded bg-[#e5e9f0]"></div>
						<div class="flex gap-2">
							<div class="h-6 w-20 rounded-full bg-[#e5e9f0]"></div>
							<div class="h-6 w-24 rounded-full bg-[#e5e9f0]"></div>
						</div>
						<div class="h-24 rounded-[10px] bg-[#e5e9f0]"></div>
						<div class="space-y-3">
							<div class="h-16 rounded-[12px] bg-[#e5e9f0]"></div>
							<div class="h-16 rounded-[12px] bg-[#e5e9f0]"></div>
						</div>
					</div>
				</div>
				<!-- Rail skeleton -->
				<div class="flex flex-col gap-3.5">
					{#each Array(5) as _, i (i)}
						<div class="h-32 rounded-[12px] bg-[#e5e9f0]"></div>
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}
