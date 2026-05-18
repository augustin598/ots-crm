<script lang="ts">
	import {
		getTaskMaterials,
		getAvailableMaterialsForTask,
		linkMaterialToTask,
		unlinkMaterialFromTask
	} from '$lib/remotes/task-materials.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers, getClientUsers } from '$lib/remotes/users.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import {
		approveTask,
		rejectTask,
		reopenTask,
		getTasks,
		getTask,
		getCompletedTasks,
		updateTask,
		toggleSubtask,
		addSubtask,
		deleteSubtask,
		addAssignee,
		removeAssignee,
		addTag,
		removeTag,
		scheduleMeet
	} from '$lib/remotes/tasks.remote';
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import { getTaskComments } from '$lib/remotes/task-comments.remote';
	import { getTaskFilters } from '$lib/components/task-filters-context';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Separator } from '$lib/components/ui/separator';
	import * as Popover from '$lib/components/ui/popover';
	import InlineEditableText from '$lib/components/inline-editable-text.svelte';
	import { Calendar as CalendarPicker } from '$lib/components/ui/calendar';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import {
		formatStatus,
		getStatusBadgeVariant,
		formatDate,
		getPriorityColor,
		getPriorityDotColor,
		getStatusDotColor,
		formatPriority
	} from '$lib/components/task-kanban-utils';
	import {
		User,
		Building,
		Check,
		X,
		History,
		Plus,
		RefreshCw,
		Link,
		Unlink,
		Image,
		Video,
		FileText,
		Type,
		ExternalLink,
		Repeat,
		Users,
		Clock,
		CheckSquare2,
		Square,
		ChevronLeft
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import type { Task } from '$lib/server/db/schema';
	import TaskDetailHeader from './task-detail-header.svelte';
	import TaskCommentThread from './task-comment-thread.svelte';
	import TaskActivityTimeline from './task-activity-timeline.svelte';

	interface Props {
		task: (Task & { subtasks?: any[]; tags?: any[]; assignees?: any[] }) | null;
		currentUserId?: string;
		mode: 'panel' | 'dialog' | 'fullpage';
		tenantSlug?: string;
		onClose: () => void;
		additionalQueriesToUpdate?: any[];
		isClient?: boolean;
	}

	let {
		task,
		currentUserId,
		mode,
		tenantSlug = '',
		onClose,
		additionalQueriesToUpdate = [],
		isClient = false
	}: Props = $props();

	const filterParams = getTaskFilters();

	// Optimistic local overrides — reset only when task identity changes
	let localOverrides = $state<Partial<Task>>({});
	let lastTaskId = $state<string | null>(null);
	$effect(() => {
		if (task && task.id !== lastTaskId) {
			localOverrides = {};
			lastTaskId = task.id;
		}
	});
	const currentTask = $derived(task ? ({ ...task, ...localOverrides } as Task) : null);

	// Mobile accordion state
	let isMobile = $state(false);
	let progressOpen = $state(true);
	let teamOpen = $state(true);
	let materialsOpen = $state(false);
	let activityOpen = $state(false);

	$effect(() => {
		if (typeof window === 'undefined' || (mode !== 'panel' && mode !== 'fullpage')) return;
		const mql = window.matchMedia('(max-width: 767px)');
		const update = (matches: boolean) => {
			isMobile = matches;
			progressOpen = !matches;
			teamOpen = !matches;
			materialsOpen = false;
			activityOpen = false;
		};
		update(mql.matches);
		const handler = (e: MediaQueryListEvent) => update(e.matches);
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	// Due date
	let dueDateOpen = $state(false);
	const dueDateValue = $derived.by<DateValue | undefined>(() => {
		const d = currentTask?.dueDate;
		if (!d) return undefined;
		const dt = new Date(d);
		return new CalendarDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
	});

	// Approval loading
	let approvalLoading = $state(false);

	// Subtask state
	let newSubtaskTitle = $state('');
	let subtaskLoading = $state<Record<string, boolean>>({});

	// Team state
	let addAssigneeOpen = $state(false);

	// Materials
	let materialsTab = $state<'all' | 'img' | 'vid' | 'doc'>('all');
	let materialPickerOpen = $state(false);
	let materialSearchTerm = $state('');
	let linkingMaterialId = $state<string | null>(null);
	let uploadingMaterial = $state(false);
	let materialFileInput: HTMLInputElement | null = $state(null);

	// Meet modal (panel only)
	let showMeetModal = $state(false);
	let meetTitle = $state('');
	let meetDate = $state('');
	let meetTime = $state('');
	let meetDuration = $state('30');
	let meetLink = $state('');
	let meetSaving = $state(false);

	$effect(() => {
		if (showMeetModal && task) {
			meetTitle = task.title;
			meetDate = new Date().toISOString().split('T')[0];
			meetTime = (task as any).meetTime ?? '10:00';
			meetDuration = String((task as any).meetDurationMinutes ?? 30);
			meetLink = '';
		}
	});

	// Queries
	const commentsQuery = $derived(task ? getTaskComments(task.id) : null);
	const comments = $derived(commentsQuery?.current || []);

	// Lazy-load: activities query fires only when activityOpen === true
	const activitiesQuery = $derived(activityOpen && task ? getTaskActivities(task.id) : null);
	const activities = $derived(activitiesQuery?.current || []);

	// Lazy-load: materials query fires only when materialsOpen === true
	const materialsQuery = $derived(materialsOpen && task ? getTaskMaterials(task.id) : null);
	const taskMaterials = $derived(materialsQuery?.current || []);

	const availableMaterialsQuery = $derived(
		task && materialPickerOpen ? getAvailableMaterialsForTask(task.id) : null
	);
	const availableMaterials = $derived(availableMaterialsQuery?.current || []);
	const filteredAvailableMaterials = $derived(
		materialSearchTerm.trim()
			? availableMaterials.filter((m: any) =>
					m.title.toLowerCase().includes(materialSearchTerm.toLowerCase())
				)
			: availableMaterials
	);

	const MATERIAL_TYPE_ICONS: Record<string, typeof Image> = {
		image: Image,
		video: Video,
		document: FileText,
		text: Type,
		url: ExternalLink
	};

	const filteredMaterials = $derived(
		taskMaterials.filter((m: any) => {
			if (materialsTab === 'all') return true;
			if (materialsTab === 'img') return m.materialType === 'image';
			if (materialsTab === 'vid') return m.materialType === 'video';
			if (materialsTab === 'doc')
				return (
					m.materialType === 'document' ||
					m.materialType === 'text' ||
					m.materialType === 'url'
				);
			return true;
		})
	);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const userMap = $derived(
		new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email]))
	);

	const clientUsersQuery = $derived(task?.clientId ? getClientUsers(task.clientId) : null);
	const mentionUsers = $derived(clientUsersQuery?.current || users);

	const topLevelComments = $derived(comments.filter((c: any) => !c.parentCommentId));
	const repliesMap = $derived(
		comments.reduce((map: Map<string, any[]>, c: any) => {
			if (c.parentCommentId) {
				const existing = map.get(c.parentCommentId) || [];
				existing.push(c);
				map.set(c.parentCommentId, existing);
			}
			return map;
		}, new Map<string, any[]>())
	);

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);
	const projectMap = $derived(new Map(projects.map((p) => [p.id, p.name])));

	const clientsQuery = getClients();
	const clientsList = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clientsList.map((c: any) => [c.id, c.name])));

	const clientOptions = $derived([
		{ value: '', label: '—' },
		...(clientsList as { id: string; name: string }[]).map((c) => ({
			value: c.id,
			label: c.name
		}))
	]);

	const subtasks = $derived((task as any)?.subtasks ?? []);
	const tags = $derived((task as any)?.tags ?? []);
	const assignees = $derived((task as any)?.assignees ?? []);
	const subDone = $derived(subtasks.filter((s: any) => s.done).length);
	const subTotal = $derived(subtasks.length);
	const subPct = $derived(subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0);

	const assigneeOptions = $derived(
		users
			.filter((u) => !assignees.some((a: any) => a.userId === u.id))
			.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.email }))
	);

	const isOverdue = $derived(
		!!(
			currentTask?.dueDate &&
			currentTask.status !== 'done' &&
			currentTask.status !== 'cancelled' &&
			new Date(currentTask.dueDate) < new Date()
		)
	);

	function formatRecurrenceLabel(t: {
		isRecurring?: boolean | null;
		recurringType?: string | null;
		recurringInterval?: number | null;
	}): string {
		if (!t.isRecurring || !t.recurringType) return 'Recurent';
		const interval = t.recurringInterval || 1;
		const typeLabels: Record<string, [string, string]> = {
			daily: ['zi', 'zile'],
			weekly: ['săptămână', 'săptămâni'],
			monthly: ['lună', 'luni'],
			yearly: ['an', 'ani']
		};
		const [singular, plural] = typeLabels[t.recurringType] || ['', ''];
		if (interval === 1) return `Recurent · în fiecare ${singular}`;
		return `Recurent · la ${interval} ${plural}`;
	}

	async function saveField<K extends keyof Task>(field: K, value: Task[K]) {
		if (!task) return;
		if (field === 'title' && !String(value ?? '').trim()) {
			toast.error('Titlul nu poate fi gol');
			return;
		}
		const previous = currentTask?.[field];
		localOverrides = { ...localOverrides, [field]: value };
		try {
			const payload: any = { taskId: task.id, title: currentTask?.title ?? task.title };
			if (field === 'title') {
				payload.title = value;
			} else {
				const v = value === '' || value === null ? undefined : value;
				if (v !== undefined) payload[field] = v;
			}
			await updateTask(payload).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getTask(task.id),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);
		} catch (e) {
			localOverrides = { ...localOverrides, [field]: previous };
			toast.error(`Nu s-a putut salva: ${e instanceof Error ? e.message : 'eroare'}`);
		}
	}

	function handleDueDateSelect(value: DateValue | undefined) {
		dueDateOpen = false;
		if (!value) return;
		const iso = `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
		saveField('dueDate', iso as any);
	}

	async function handleApprove() {
		if (!task) return;
		approvalLoading = true;
		try {
			await approveTask({ taskId: task.id }).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getTask(task.id),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);
			toast.success('Task aprobat');
			onClose();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			approvalLoading = false;
		}
	}

	async function handleReject() {
		if (!task || !confirm('Respingi acest task?')) return;
		approvalLoading = true;
		try {
			await rejectTask(task.id).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getTask(task.id),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);
			toast.success('Task respins');
			onClose();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			approvalLoading = false;
		}
	}

	async function handleReopen() {
		if (!task) return;
		approvalLoading = true;
		try {
			await reopenTask({ taskId: task.id }).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getTask(task.id),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);
			toast.success('Task redeschis');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			approvalLoading = false;
		}
	}

	async function handleLinkMaterial(materialId: string) {
		if (!task) return;
		linkingMaterialId = materialId;
		try {
			await linkMaterialToTask({ taskId: task.id, materialId }).updates(
				getTaskMaterials(task.id),
				getAvailableMaterialsForTask(task.id)
			);
			toast.success('Material adăugat');
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la adăugare material');
		} finally {
			linkingMaterialId = null;
		}
	}

	async function handleUnlinkMaterial(materialId: string) {
		if (!task || !confirm('Elimini legătura cu acest material?')) return;
		try {
			await unlinkMaterialFromTask({ taskId: task.id, materialId }).updates(
				getTaskMaterials(task.id),
				getAvailableMaterialsForTask(task.id)
			);
			toast.success('Material eliminat');
		} catch (e: any) {
			toast.error(e?.message || 'Eroare');
		}
	}

	async function handleUploadMaterial(file: File) {
		if (!task || !tenantSlug) return;
		uploadingMaterial = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('taskId', task.id);
			const res = await fetch(`/${tenantSlug}/task-materials/upload`, { method: 'POST', body: fd });
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Upload eșuat' }));
				throw new Error(err.message || `HTTP ${res.status}`);
			}
			await getTaskMaterials(task.id).refresh?.();
			toast.success('Material încărcat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la upload');
		} finally {
			uploadingMaterial = false;
			if (materialFileInput) materialFileInput.value = '';
		}
	}

	async function handleToggleSubtask(subtaskId: string, done: boolean) {
		if (!task) return;
		subtaskLoading = { ...subtaskLoading, [subtaskId]: true };
		try {
			await toggleSubtask({ subtaskId, done }).updates(getTask(task.id));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			subtaskLoading = { ...subtaskLoading, [subtaskId]: false };
		}
	}

	async function handleAddSubtask() {
		if (!task || !newSubtaskTitle.trim()) return;
		try {
			await addSubtask({ taskId: task.id, title: newSubtaskTitle.trim() }).updates(getTask(task.id));
			newSubtaskTitle = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la adăugare subtask');
		}
	}

	async function handleDeleteSubtask(subtaskId: string) {
		if (!task) return;
		try {
			await deleteSubtask(subtaskId).updates(getTask(task.id));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleAddAssignee(userId: string) {
		if (!task) return;
		addAssigneeOpen = false;
		try {
			await addAssignee({ taskId: task.id, userId }).updates(getTask(task.id));
			toast.success('Membru adăugat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleRemoveAssignee(userId: string) {
		if (!task) return;
		try {
			await removeAssignee({ taskId: task.id, userId }).updates(
				getTask(task.id),
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true })
			);
			toast.success('Membru eliminat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleAddTag(tagName: string) {
		if (!task) return;
		try {
			await addTag({ taskId: task.id, tagName }).updates(getTask(task.id));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la adăugare tag');
		}
	}

	async function handleRemoveTag(tagId: string) {
		if (!task) return;
		try {
			await removeTag({ taskId: task.id, tagId }).updates(getTask(task.id));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleSaveMeet() {
		if (!task) return;
		meetSaving = true;
		try {
			await scheduleMeet({
				taskId: task.id,
				meetLink: meetLink || undefined,
				meetTime: meetTime || undefined,
				meetDurationMinutes: meetDuration ? parseInt(meetDuration) : undefined
			}).updates(getTask(task.id));
			showMeetModal = false;
			toast.success('Meeting programat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			meetSaving = false;
		}
	}

	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}
</script>

{#if !task}
	<div class="flex h-full items-center justify-center p-6">
		<p class="text-muted-foreground text-sm">Se încarcă...</p>
	</div>
{:else if task && currentTask}
	{#if mode === 'panel' || mode === 'fullpage'}
		<!-- ══ PANEL / FULLPAGE LAYOUT ══ -->
		<div class="flex min-h-full flex-col">

			<TaskDetailHeader
				{currentTask}
				{tags}
				{isOverdue}
				{isClient}
				onBack={onClose}
				onScheduleMeet={() => (showMeetModal = true)}
				onSaveField={saveField}
				onRemoveTag={handleRemoveTag}
				onAddTag={handleAddTag}
			/>

			<!-- BODY -->
			<div class="flex flex-1 flex-wrap md:flex-nowrap">

				<!-- MAIN COLUMN -->
				<div class="w-full min-w-0 p-6 md:flex-1">
					<div class="space-y-6">

						<!-- Metadata row -->
						<div
							class="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[#e5e9f0] bg-white px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
						>
							<div class="flex items-center gap-2">
								<User class="h-4 w-4 shrink-0 text-muted-foreground" />
								<Select
									type="single"
									value={currentTask.assignedToUserId ?? ''}
									onValueChange={(v) => saveField('assignedToUserId', (v || '') as any)}
								>
									<SelectTrigger class="h-auto border-0 p-0 text-sm font-medium shadow-none">
										{userMap.get(currentTask.assignedToUserId ?? '') ?? 'Responsabil'}
									</SelectTrigger>
									<SelectContent>
										{#each users as u (u.id)}
											<SelectItem value={u.id}
												>{`${u.firstName} ${u.lastName}`.trim() || u.email}</SelectItem
											>
										{/each}
									</SelectContent>
								</Select>
							</div>

							<div class="flex items-center gap-2">
								<CalendarIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
								<Popover.Root bind:open={dueDateOpen}>
									<Popover.Trigger>
										{#snippet child({ props })}
											<button
												{...props}
												type="button"
												class="text-sm font-medium hover:underline focus:outline-none"
											>
												{currentTask.dueDate ? formatDate(currentTask.dueDate) : 'Termen limită'}
											</button>
										{/snippet}
									</Popover.Trigger>
									<Popover.Content class="w-auto p-0" align="start">
										<CalendarPicker
											type="single"
											value={dueDateValue}
											onValueChange={handleDueDateSelect}
											locale="ro-RO"
										/>
									</Popover.Content>
								</Popover.Root>
							</div>

							<div class="flex items-center gap-2">
								<Building class="h-4 w-4 shrink-0 text-muted-foreground" />
								<Popover.Root>
									<Popover.Trigger>
										{#snippet child({ props })}
											<button
												{...props}
												type="button"
												class="text-sm font-medium hover:underline focus:outline-none"
											>
												{clientMap.get(currentTask.clientId ?? '') ?? 'Client'}
											</button>
										{/snippet}
									</Popover.Trigger>
									<Popover.Content class="w-64 p-2">
										<Combobox
											value={currentTask.clientId ?? ''}
											options={clientOptions}
											placeholder="Alege client"
											searchPlaceholder="Caută..."
											onValueChange={(v) => saveField('clientId', ((v as string) || '') as any)}
										/>
									</Popover.Content>
								</Popover.Root>
							</div>

							{#if task.createdAt}
								<div class="flex items-center gap-1 text-muted-foreground">
									<Clock class="h-3.5 w-3.5 shrink-0" />
									<span>{formatDate(task.createdAt as any)}</span>
								</div>
							{/if}

							{#if (currentTask as any).meetTime}
								{@const mt = (currentTask as any).meetTime}
								{@const dur = (currentTask as any).meetDurationMinutes}
								{@const ml = (currentTask as any).meetLink}
								{@const endHour = dur ? (() => { const [h, m] = mt.split(':').map(Number); const total = h * 60 + m + dur; return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; })() : null}
								<div class="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
									📅 {mt}{endHour ? ` - ${endHour}` : ''}{#if ml} — <a href={ml} target="_blank" rel="noopener noreferrer" class="underline hover:text-emerald-600">{new URL(ml).hostname}</a>{/if}
								</div>
							{/if}
						</div>

						<!-- Description -->
						<div>
							<h4 class="mb-2 text-sm font-semibold text-gray-700">Descriere</h4>
							<InlineEditableText
								value={currentTask.description ?? ''}
								onSave={(v) => saveField('description', (v || null) as any)}
								multiline
								placeholder="Scrie o descriere..."
								emptyPlaceholder="Click pentru a adăuga o descriere"
								displayClass="text-muted-foreground leading-relaxed whitespace-pre-wrap text-sm"
								ariaLabel="Editează descrierea"
							/>
						</div>

						<Separator />

						<!-- Comments -->
						<TaskCommentThread
							taskId={task.id}
							{currentUserId}
							{tenantSlug}
							{comments}
							{topLevelComments}
							{repliesMap}
							{mentionUsers}
							{userMap}
						/>
					</div>
				</div>

				<!-- RIGHT RAIL -->
				<aside
					class="w-full border-t border-[#e5e9f0] bg-white md:w-[280px] md:shrink-0 md:border-t-0 md:border-l dark:border-zinc-700 dark:bg-zinc-900"
				>
					<div class="space-y-3 p-4">

						<!-- PROGRES / SUBTASKS card — eager -->
						<details bind:open={progressOpen} class="overflow-hidden rounded-xl border border-[#e5e9f0] bg-white dark:border-zinc-700 dark:bg-zinc-900">
							<summary
								class="flex cursor-pointer select-none list-none items-center justify-between p-4 text-sm font-semibold"
							>
								<span class="flex items-center gap-2">
									<CheckSquare2 class="h-4 w-4 text-muted-foreground" />
									Progres ({subDone}/{subTotal})
								</span>
								<ChevronLeft
									class="h-4 w-4 text-muted-foreground transition-transform md:hidden {progressOpen
										? '-rotate-90'
										: 'rotate-180'}"
								/>
							</summary>
							<div class="space-y-3 px-4 pb-4">
								<div>
									<div class="h-2 w-full overflow-hidden rounded-full bg-slate-200">
										<div
											class="h-full rounded-full bg-emerald-500 transition-all"
											style="width: {subPct}%"
										></div>
									</div>
									<div class="mt-1 flex justify-between text-xs text-muted-foreground">
										<span>{subPct}% complet</span>
										<span>{subTotal - subDone} rămase</span>
									</div>
								</div>
								<div class="space-y-1.5">
									{#each subtasks as sub (sub.id)}
										<div class="group flex items-center gap-2">
											<button
												type="button"
												aria-label="Marchează ca {sub.done ? 'nefinalizat' : 'finalizat'}"
												class="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
												disabled={subtaskLoading[sub.id]}
												onclick={() => handleToggleSubtask(sub.id, !sub.done)}
											>
												{#if sub.done}
													<CheckSquare2 class="h-4 w-4 text-emerald-500" />
												{:else}
													<Square class="h-4 w-4" />
												{/if}
											</button>
											<span
												class="flex-1 text-sm leading-tight {sub.done
													? 'line-through text-muted-foreground'
													: ''}">{sub.title}</span
											>
											<button
												type="button"
												aria-label="Șterge subtask"
												class="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
												onclick={() => handleDeleteSubtask(sub.id)}
											>
												<X class="h-3.5 w-3.5" />
											</button>
										</div>
									{/each}
								</div>
								<form
									onsubmit={(e) => {
										e.preventDefault();
										handleAddSubtask();
									}}
									class="flex items-center gap-2"
								>
									<input
										type="text"
										bind:value={newSubtaskTitle}
										placeholder="Adaugă subtask..."
										class="h-8 flex-1 rounded-lg border border-[#d5dbe5] bg-[#f7f8fa] px-3 text-sm focus:bg-white focus:outline-none focus:ring-1 focus:ring-ring dark:border-zinc-700 dark:bg-zinc-800"
									/>
									<button
										type="submit"
										aria-label="Adaugă subtask"
										class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
										disabled={!newSubtaskTitle.trim()}
									>
										<Plus class="h-4 w-4" />
									</button>
								</form>
							</div>
						</details>

						<!-- ECHIPĂ card — eager -->
						<details bind:open={teamOpen} class="overflow-hidden rounded-xl border border-[#e5e9f0] bg-white dark:border-zinc-700 dark:bg-zinc-900">
							<summary
								class="flex cursor-pointer select-none list-none items-center justify-between p-4 text-sm font-semibold"
							>
								<span class="flex items-center gap-2">
									<Users class="h-4 w-4 text-muted-foreground" />
									Echipă ({assignees.length})
								</span>
								<ChevronLeft
									class="h-4 w-4 text-muted-foreground transition-transform md:hidden {teamOpen
										? '-rotate-90'
										: 'rotate-180'}"
								/>
							</summary>
							<div class="space-y-2 px-4 pb-4">
								{#each assignees as assignee (assignee.userId)}
									{@const fullName =
										`${assignee.firstName} ${assignee.lastName}`.trim() || assignee.email}
									<div class="group flex items-center gap-3">
										<div
											class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
										>
											{getInitials(fullName)}
										</div>
										<div class="min-w-0 flex-1">
											<p class="truncate text-sm font-medium">{fullName}</p>
											{#if assignee.role}
												<p class="text-xs text-muted-foreground">{assignee.role}</p>
											{/if}
										</div>
										<span
											class="h-2 w-2 shrink-0 rounded-full bg-emerald-400"
											title="Online"
										></span>
										<button
											type="button"
											aria-label="Elimină {fullName} din echipă"
											class="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
											onclick={() => handleRemoveAssignee(assignee.userId)}
										>
											<X class="h-3.5 w-3.5" />
										</button>
									</div>
								{/each}
								{#if assigneeOptions.length > 0}
									<Popover.Root bind:open={addAssigneeOpen}>
										<Popover.Trigger>
											{#snippet child({ props })}
												<button
													{...props}
													type="button"
													class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
												>
													<Plus class="h-4 w-4" /> Adaugă membru
												</button>
											{/snippet}
										</Popover.Trigger>
										<Popover.Content class="w-64 p-2">
											<div class="max-h-48 space-y-0.5 overflow-y-auto">
												{#each assigneeOptions as opt}
													<button
														type="button"
														class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
														onclick={() => handleAddAssignee(opt.value)}
													>
														<div
															class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary"
														>
															{getInitials(opt.label)}
														</div>
														{opt.label}
													</button>
												{/each}
											</div>
										</Popover.Content>
									</Popover.Root>
								{/if}
							</div>
						</details>

						<!-- MATERIALE card — lazy (loads on open) -->
						<details bind:open={materialsOpen} class="overflow-hidden rounded-xl border border-[#e5e9f0] bg-white dark:border-zinc-700 dark:bg-zinc-900">
							<summary
								class="flex cursor-pointer select-none list-none items-center justify-between p-4 text-sm font-semibold"
							>
								<span class="flex items-center gap-2">
									<Link class="h-4 w-4 text-muted-foreground" />
									Materiale
								</span>
								<ChevronLeft
									class="h-4 w-4 text-muted-foreground transition-transform md:hidden {materialsOpen
										? '-rotate-90'
										: 'rotate-180'}"
								/>
							</summary>
							<div class="space-y-3 px-4 pb-4">
								{#if !materialsQuery}
									<p class="text-xs text-muted-foreground">Deschide pentru a vedea materialele.</p>
								{:else}
									<div class="flex gap-1 rounded-lg bg-slate-100 p-1">
										{#each [['all', 'Toate'], ['img', 'Foto'], ['vid', 'Video'], ['doc', 'Docs']] as [tab, label]}
											<button
												type="button"
												class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors {materialsTab ===
												tab
													? 'bg-white shadow-sm text-foreground'
													: 'text-muted-foreground hover:text-foreground'}"
												onclick={() => (materialsTab = tab as any)}>{label}</button
											>
										{/each}
									</div>
									{#if filteredMaterials.length === 0}
										<p class="text-xs text-muted-foreground">Niciun material.</p>
									{:else}
										<div class="space-y-1.5">
											{#each filteredMaterials as mat}
												{@const Icon = MATERIAL_TYPE_ICONS[mat.materialType] || FileText}
												<div
													class="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
												>
													<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
													<div class="min-w-0 flex-1">
														{#if mat.materialExternalUrl}
															<a
																href={mat.materialExternalUrl}
																target="_blank"
																rel="noopener noreferrer"
																class="block truncate text-xs font-medium hover:text-primary"
																>{mat.materialTitle}</a
															>
														{:else}
															<p class="truncate text-xs font-medium">{mat.materialTitle}</p>
														{/if}
														<p class="text-xs text-muted-foreground capitalize">{mat.materialType}</p>
													</div>
													<button
														type="button"
														aria-label="Elimină material"
														class="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
														onclick={() => handleUnlinkMaterial(mat.materialId)}
													>
														<Unlink class="h-3.5 w-3.5" />
													</button>
												</div>
											{/each}
										</div>
									{/if}
									<input
										bind:this={materialFileInput}
										type="file"
										class="hidden"
										accept="image/*,video/*,.pdf,.doc,.docx"
										onchange={(e) => {
											const f = (e.currentTarget as HTMLInputElement).files?.[0];
											if (f) handleUploadMaterial(f);
										}}
									/>
									<button
										type="button"
										class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
										disabled={uploadingMaterial}
										onclick={() => materialFileInput?.click()}
									>
										<Plus class="h-3.5 w-3.5" />
										{uploadingMaterial ? 'Se încarcă...' : 'Upload material nou'}
									</button>
									<Popover.Root bind:open={materialPickerOpen}>
										<Popover.Trigger>
											{#snippet child({ props })}
												<button
													{...props}
													type="button"
													class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
												>
													<Plus class="h-3.5 w-3.5" /> Atașează material existent
												</button>
											{/snippet}
										</Popover.Trigger>
										<Popover.Content class="w-72 p-0" align="start">
											<div class="border-b p-3">
												<Input
													type="text"
													placeholder="Caută materiale..."
													bind:value={materialSearchTerm}
													class="h-8 text-sm"
												/>
											</div>
											<div class="max-h-[200px] overflow-y-auto">
												{#if filteredAvailableMaterials.length === 0}
													<p class="p-3 text-sm text-muted-foreground">
														{materialSearchTerm
															? 'Niciun material găsit.'
															: 'Nu există materiale disponibile.'}
													</p>
												{:else}
													{#each filteredAvailableMaterials as mat}
														{@const Icon = MATERIAL_TYPE_ICONS[mat.type] || FileText}
														<button
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
															onclick={() => handleLinkMaterial(mat.id)}
															disabled={linkingMaterialId === mat.id}
														>
															<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
															<span class="flex-1 truncate">{mat.title}</span>
															<Badge variant="outline" class="shrink-0 text-xs">{mat.type}</Badge>
														</button>
													{/each}
												{/if}
											</div>
										</Popover.Content>
									</Popover.Root>
								{/if}
							</div>
						</details>

						<!-- ACTIVITATE card — lazy (loads on open) -->
						<details bind:open={activityOpen} class="overflow-hidden rounded-xl border border-[#e5e9f0] bg-white dark:border-zinc-700 dark:bg-zinc-900">
							<summary
								class="flex cursor-pointer select-none list-none items-center justify-between p-4 text-sm font-semibold"
							>
								<span class="flex items-center gap-2">
									<History class="h-4 w-4 text-muted-foreground" />
									Activitate
								</span>
								<ChevronLeft
									class="h-4 w-4 text-muted-foreground transition-transform {activityOpen
										? '-rotate-90'
										: 'rotate-180'}"
								/>
							</summary>
							<div class="px-4 pb-4">
								{#if !activitiesQuery}
									<p class="text-sm text-muted-foreground">Deschide pentru a vedea activitatea.</p>
								{:else}
									<TaskActivityTimeline
										{activities}
										{userMap}
										{clientMap}
										{projectMap}
									/>
								{/if}
							</div>
						</details>

					</div>
				</aside>
			</div>

			<!-- STICKY FOOTER -->
			<div
				class="sticky bottom-0 z-20 flex shrink-0 items-center gap-2 border-t bg-white px-6 py-3"
			>
				{#if !isClient && (currentTask.status === 'done' || currentTask.status === 'cancelled')}
					<Button onclick={handleReopen} disabled={approvalLoading} variant="outline">
						<RefreshCw class="mr-2 h-4 w-4" />
						Redeschide task
					</Button>
				{:else if !isClient && currentTask.status === 'pending-approval'}
					<Button onclick={handleApprove} disabled={approvalLoading}>
						<Check class="mr-2 h-4 w-4" />
						Aprobă
					</Button>
					<Button variant="destructive" onclick={handleReject} disabled={approvalLoading}>
						<X class="mr-2 h-4 w-4" />
						Respinge
					</Button>
				{:else if !isClient}
					<Button
						onclick={() => saveField('status', 'done')}
						class="bg-emerald-600 text-white hover:bg-emerald-700"
					>
						<Check class="mr-2 h-4 w-4" />
						Marchează ca terminat
					</Button>
				{/if}
			</div>
		</div>

		<!-- MEET MODAL (panel only) -->
		{#if showMeetModal}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
				onclick={(e) => {
					if (e.target === e.currentTarget) showMeetModal = false;
				}}
				onkeydown={(e) => {
					if (e.key === 'Escape') showMeetModal = false;
				}}
				role="dialog"
				aria-modal="true"
				tabindex="-1"
			>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="w-full max-w-md rounded-2xl bg-white shadow-2xl"
					onclick={(e) => e.stopPropagation()}
					onkeydown={() => {}}
					role="document"
				>
					<div class="flex items-center justify-between border-b px-6 py-4">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<path d="M16 8.5V12.5L20 16V5L16 8.5Z" fill="#00897B" />
									<path
										d="M3 6V18C3 18.5523 3.44772 19 4 19H14C14.5523 19 15 18.5523 15 18V14L11 14V6H3Z"
										fill="#1E88E5"
									/>
									<path d="M11 6V14H15V10L11 6Z" fill="#FBC02D" />
									<path d="M15 14L11 10V14H15Z" fill="#E53935" />
									<path d="M11 6L15 10V6H11Z" fill="#4CAF50" />
								</svg>
							</div>
							<div>
								<h2 class="text-base font-bold text-gray-900">Programează Google Meet</h2>
								<p class="text-xs text-muted-foreground">Salvează detaliile întâlnirii la task</p>
							</div>
						</div>
						<button
							type="button"
							class="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
							onclick={() => (showMeetModal = false)}
						>
							<X class="h-5 w-5" />
						</button>
					</div>
					<div class="space-y-4 px-6 py-4">
						<div class="space-y-1.5">
							<label class="text-sm font-medium" for="meet-title">Titlu meeting</label>
							<Input id="meet-title" type="text" bind:value={meetTitle} placeholder="Titlu meeting" />
						</div>
						<div class="grid grid-cols-3 gap-3">
							<div class="space-y-1.5">
								<label class="text-sm font-medium" for="meet-date">Dată</label>
								<Input id="meet-date" type="date" bind:value={meetDate} />
							</div>
							<div class="space-y-1.5">
								<label class="text-sm font-medium" for="meet-time">Oră</label>
								<Input id="meet-time" type="time" bind:value={meetTime} />
							</div>
							<div class="space-y-1.5">
								<label class="text-sm font-medium" for="meet-duration">Durată</label>
								<select
									id="meet-duration"
									bind:value={meetDuration}
									class="h-9 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
								>
									<option value="15">15 min</option>
									<option value="30">30 min</option>
									<option value="45">45 min</option>
									<option value="60">1 oră</option>
									<option value="90">1h 30 min</option>
								</select>
							</div>
						</div>
						<div class="space-y-1.5">
							<label class="text-sm font-medium" for="meet-link"
								>Link Google Meet (opțional)</label
							>
							<Input
								id="meet-link"
								type="url"
								bind:value={meetLink}
								placeholder="https://meet.google.com/..."
							/>
							<p class="text-xs text-muted-foreground">Lipește linkul Meet generat manual</p>
						</div>
					</div>
					<div class="flex items-center justify-end gap-2 border-t px-6 py-4">
						<Button variant="outline" onclick={() => (showMeetModal = false)}>Anulează</Button>
						<Button
							onclick={handleSaveMeet}
							disabled={meetSaving}
							class="bg-emerald-600 text-white hover:bg-emerald-700"
						>
							<Check class="mr-2 h-4 w-4" />
							{meetSaving ? 'Se salvează...' : 'Salvează'}
						</Button>
					</div>
				</div>
			</div>
		{/if}

	{:else}
		<!-- ══ DIALOG LAYOUT ══ -->
		<div class="space-y-6">

			<!-- Dialog-style header: title + pills + approve/reject -->
			<div>
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0 flex-1">
						<div class="text-2xl font-semibold">
							<InlineEditableText
								value={currentTask.title}
								onSave={(v) => saveField('title', v)}
								displayClass="text-2xl font-semibold"
								ariaLabel="Editează titlul task-ului"
							/>
						</div>
						{#if task.projectId && projectMap.has(task.projectId)}
							<p class="mt-1 text-sm text-muted-foreground">{projectMap.get(task.projectId)}</p>
						{/if}
						<div class="mt-3 flex flex-wrap items-center gap-2">
							<Popover.Root>
								<Popover.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											aria-label="Schimbă prioritatea"
											class="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											<Badge class={getPriorityColor(currentTask.priority || 'medium')}>
												{formatPriority(currentTask.priority || 'medium')}
											</Badge>
										</button>
									{/snippet}
								</Popover.Trigger>
								<Popover.Content class="w-48 p-1">
									{#each [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] as [val, label] (val)}
										<button
											type="button"
											class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
											onclick={() => saveField('priority', val as any)}
										>
											<span class="h-2 w-2 rounded-full {getPriorityDotColor(val)}"></span>{label}
										</button>
									{/each}
								</Popover.Content>
							</Popover.Root>

							<Popover.Root>
								<Popover.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											aria-label="Schimbă statusul"
											class="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											<Badge variant={getStatusBadgeVariant(currentTask.status)}>
												{formatStatus(currentTask.status || 'todo')}
											</Badge>
										</button>
									{/snippet}
								</Popover.Trigger>
								<Popover.Content class="w-52 p-1">
									{#each [['pending-approval', 'Pending Approval'], ['todo', 'To Do'], ['in-progress', 'In Progress'], ['review', 'Review'], ['done', 'Done'], ['cancelled', 'Cancelled']] as [val, label] (val)}
										<button
											type="button"
											class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
											onclick={() => saveField('status', val as any)}
										>
											<span class="h-2 w-2 rounded-full {getStatusDotColor(val)}"></span>{label}
										</button>
									{/each}
								</Popover.Content>
							</Popover.Root>

							{#if currentTask.recurringParentId}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800"
								>
									<Repeat class="h-3 w-3" /> Din serie recurentă
								</span>
							{:else if currentTask.isRecurring}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800"
								>
									<Repeat class="h-3 w-3" /> {formatRecurrenceLabel(currentTask)}
								</span>
							{/if}
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-2">
						{#if currentTask.status === 'pending-approval'}
							<Button variant="default" size="sm" onclick={handleApprove} disabled={approvalLoading}>
								<Check class="mr-2 h-4 w-4" /> Aprobă
							</Button>
							<Button variant="destructive" size="sm" onclick={handleReject} disabled={approvalLoading}>
								<X class="mr-2 h-4 w-4" /> Respinge
							</Button>
						{:else if currentTask.status === 'done' || currentTask.status === 'cancelled'}
							<Button variant="outline" size="sm" onclick={handleReopen} disabled={approvalLoading}>
								<RefreshCw class="mr-2 h-4 w-4" /> Redeschide
							</Button>
						{/if}
						<Button variant="ghost" size="sm" onclick={onClose}>
							<X class="h-4 w-4" />
						</Button>
					</div>
				</div>
			</div>

			<!-- Metadata grid -->
			<div class="grid gap-4 md:grid-cols-2">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
						<Building class="h-5 w-5 text-orange-600" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm text-muted-foreground">Client</p>
						<Popover.Root>
							<Popover.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										type="button"
										class="w-full truncate text-left font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										aria-label="Schimbă clientul"
									>
										{clientMap.get(currentTask.clientId ?? '') ?? 'Alege client'}
									</button>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content class="w-64 p-2">
								<Combobox
									value={currentTask.clientId ?? ''}
									options={clientOptions}
									placeholder="Alege client"
									searchPlaceholder="Caută..."
									onValueChange={(v) => saveField('clientId', ((v as string) || '') as any)}
								/>
							</Popover.Content>
						</Popover.Root>
					</div>
				</div>

				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
						<User class="h-5 w-5 text-primary" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm text-muted-foreground">Responsabil</p>
						<Select
							type="single"
							value={currentTask.assignedToUserId ?? ''}
							onValueChange={(v) => saveField('assignedToUserId', (v || '') as any)}
						>
							<SelectTrigger class="h-auto border-0 p-0 font-medium shadow-none">
								{userMap.get(currentTask.assignedToUserId ?? '') ??
									currentTask.assignedToUserId ??
									'Alege responsabil'}
							</SelectTrigger>
							<SelectContent>
								{#each users as u (u.id)}
									<SelectItem value={u.id}
										>{`${u.firstName} ${u.lastName}`.trim() || u.email}</SelectItem
									>
								{/each}
							</SelectContent>
						</Select>
					</div>
				</div>

				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
						<CalendarIcon class="h-5 w-5 text-blue-600" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm text-muted-foreground">Termen limită</p>
						<Popover.Root bind:open={dueDateOpen}>
							<Popover.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										type="button"
										class="text-left font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										aria-label="Schimbă data limită"
									>
										{currentTask.dueDate ? formatDate(currentTask.dueDate) : 'Alege data'}
									</button>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content class="w-auto p-0" align="start">
								<CalendarPicker
									type="single"
									value={dueDateValue}
									onValueChange={handleDueDateSelect}
									locale="ro-RO"
								/>
							</Popover.Content>
						</Popover.Root>
					</div>
				</div>
			</div>

			<Separator />

			<!-- Description -->
			<div>
				<h4 class="mb-2 font-semibold">Descriere</h4>
				<InlineEditableText
					value={currentTask.description ?? ''}
					onSave={(v) => saveField('description', (v || null) as any)}
					multiline
					placeholder="Scrie o descriere..."
					emptyPlaceholder="Click pentru a adăuga o descriere"
					displayClass="text-muted-foreground leading-relaxed whitespace-pre-wrap"
					ariaLabel="Editează descrierea"
				/>
			</div>

			<Separator />

			<!-- Materials (dialog: always shown, lazy on open via details) -->
			<details bind:open={materialsOpen} class="group">
				<summary class="flex cursor-pointer list-none items-center gap-2 font-semibold">
					<Link class="h-4 w-4 text-muted-foreground" />
					Materiale ({taskMaterials.length})
				</summary>
				{#if materialsOpen}
					<div class="mt-3">
						{#if taskMaterials.length === 0}
							<p class="text-sm text-muted-foreground">Niciun material asociat.</p>
						{:else}
							<div class="grid gap-2 sm:grid-cols-2">
								{#each taskMaterials as mat}
									{@const Icon = MATERIAL_TYPE_ICONS[mat.materialType] || FileText}
									<div class="group flex items-center gap-3 rounded-lg border p-3">
										<div
											class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted"
										>
											<Icon class="h-4 w-4 text-muted-foreground" />
										</div>
										<div class="min-w-0 flex-1">
											{#if mat.materialExternalUrl}
												<a
													href={mat.materialExternalUrl}
													target="_blank"
													rel="noopener noreferrer"
													class="block truncate text-sm font-medium hover:text-primary"
													>{mat.materialTitle}</a
												>
											{:else}
												<p class="truncate text-sm font-medium">{mat.materialTitle}</p>
											{/if}
											<p class="text-xs text-muted-foreground capitalize">{mat.materialType}</p>
										</div>
										<Button
											variant="ghost"
											size="icon"
											class="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
											onclick={() => handleUnlinkMaterial(mat.materialId)}
										>
											<Unlink class="h-3.5 w-3.5" />
										</Button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</details>

			<Separator />

			<!-- Comments -->
			<TaskCommentThread
				taskId={task.id}
				{currentUserId}
				{tenantSlug}
				{comments}
				{topLevelComments}
				{repliesMap}
				{mentionUsers}
				{userMap}
			/>

			<Separator />

			<!-- Activity (lazy) -->
			<details bind:open={activityOpen}>
				<summary class="flex cursor-pointer list-none items-center gap-2 font-semibold">
					<History class="h-4 w-4 text-muted-foreground" />
					Activitate
				</summary>
				{#if activityOpen}
					<div class="mt-3">
						<TaskActivityTimeline
							{activities}
							{userMap}
							{clientMap}
							{projectMap}
						/>
					</div>
				{/if}
			</details>
		</div>
	{/if}
{/if}
