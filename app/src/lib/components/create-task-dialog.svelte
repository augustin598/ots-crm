<script lang="ts">
	import { createTask, getTasks, getCompletedTasks } from '$lib/remotes/tasks.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers, getAssignableClientUsers } from '$lib/remotes/users.remote';
	import { getGoogleCalendarStatus } from '$lib/remotes/integrations.remote';
	import ContactAvatar from '$lib/components/ui/contact-avatar.svelte';
	import { whatsappAvatarUrl } from '$lib/utils/phone';
	import { Dialog, DialogContent } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Switch } from '$lib/components/ui/switch';
	import * as Popover from '$lib/components/ui/popover';
	import { Calendar } from '$lib/components/ui/calendar';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import { page } from '$app/state';
	import { getTaskFilters } from '$lib/components/task-filters-context';
	import { browser } from '$app/environment';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import SearchIcon from '@lucide/svelte/icons/search';

	interface Props {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onSuccess?: () => void;
		defaultProjectId?: string;
		defaultClientId?: string;
		defaultMilestoneId?: string;
		defaultDueDate?: string;
		defaultPriority?: string;
		/** Pre-select an initial status when the dialog opens. Falls back to 'todo' (or 'pending-approval' for client users). */
		defaultStatus?: string;
		isClient?: boolean;
		additionalQueriesToUpdate?: any[];
		initialType?: 'task' | 'meet';
		initialDay?: Date | null;
	}

	let {
		open,
		onOpenChange,
		onSuccess,
		defaultProjectId,
		defaultClientId,
		defaultMilestoneId,
		defaultDueDate,
		defaultPriority: defaultPriorityProp,
		defaultStatus,
		isClient = false,
		additionalQueriesToUpdate = [],
		initialType,
		initialDay
	}: Props = $props();

	const filterParams = getTaskFilters();

	const clientsQuery = $derived(getClients());
	const clients = $derived(clientsQuery.current || []);

	// --- Client picker (searchable popover) ----------------------------------
	// "Active" clients = the selection the user saved in the /ots/clients filter
	// (localStorage key `crm-clients-filter-<tenant>`). Empty/unset = show all.
	const CLIENTS_FILTER_KEY = (t: string) => `crm-clients-filter-${t}`;
	let activeClientIds = $state<string[] | null>(null);
	let clientPopoverOpen = $state(false);
	let clientSearch = $state('');
	let showAllClients = $state(false);

	// Re-read the saved active selection each time the dialog opens.
	$effect(() => {
		if (!open) return;
		const t = page.params.tenant as string | undefined;
		if (!browser || !t) return;
		try {
			const stored = localStorage.getItem(CLIENTS_FILTER_KEY(t));
			const ids = stored ? JSON.parse(stored) : null;
			activeClientIds = Array.isArray(ids) && ids.length > 0 ? ids : null;
		} catch {
			activeClientIds = null;
		}
		showAllClients = false;
		clientSearch = '';
	});

	const activeClients = $derived(
		activeClientIds ? clients.filter((c) => activeClientIds!.includes(c.id)) : clients
	);
	const baseClientList = $derived(showAllClients ? clients : activeClients);
	const visibleClients = $derived(
		clientSearch.trim()
			? baseClientList.filter((c) =>
					c.name.toLowerCase().includes(clientSearch.trim().toLowerCase())
				)
			: baseClientList
	);

	const projectsQuery = $derived(getProjects(undefined));
	const allProjects = $derived(projectsQuery.current || []);

	const usersQuery = $derived(getTenantUsers());
	const users = $derived(usersQuery.current || []);

	type AssigneeOption = {
		value: string;
		label: string;
		kind: 'agency' | 'client';
		email?: string;
		phone?: string | null;
	};

	function avatarSrcFromPhone(phone: string | null | undefined): string | null {
		return whatsappAvatarUrl((page.params.tenant as string) ?? '', phone);
	}

	// Admin sessions expose tenantUser.userId; client portal sessions only expose
	// `user.id` (the canonical users.id). Both resolve to a valid taskAssignee.userId.
	const currentUserId = $derived(
		((page.data as any)?.tenantUser?.userId as string | undefined) ??
			((page.data as any)?.user?.id as string | undefined)
	);

	const TYPES = [
		{ id: 'design', label: 'Design', color: '#8b5cf6' },
		{ id: 'video', label: 'Video', color: '#ec4899' },
		{ id: 'ads', label: 'Ads', color: '#1877F2' },
		{ id: 'dev', label: 'Dev', color: '#06b6d4' },
		{ id: 'content', label: 'Content', color: '#10b981' },
		{ id: 'meeting', label: 'Meeting', color: '#f59e0b' }
	];

	const PRIORITIES = [
		{ id: 'urgent', label: 'Urgent', color: '#ef4444' },
		{ id: 'high', label: 'High', color: '#f59e0b' },
		{ id: 'medium', label: 'Medium', color: '#10b981' },
		{ id: 'low', label: 'Low', color: '#94a3b8' }
	];

	const STATUSES_CREATE = [
		{ id: 'todo', label: 'Todo' },
		{ id: 'in-progress', label: 'In Progress' },
		{ id: 'review', label: 'Review' },
		{ id: 'blocked', label: 'Blocked' }
	];

	function getInitialDueDate(): string {
		if (initialDay) {
			const y = initialDay.getFullYear();
			const m = String(initialDay.getMonth() + 1).padStart(2, '0');
			const d = String(initialDay.getDate()).padStart(2, '0');
			return `${y}-${m}-${d}`;
		}
		return defaultDueDate || '';
	}

	// Local YYYY-MM-DD (avoids the UTC off-by-one of toISOString near midnight).
	function localTodayIso(): string {
		const d = new Date();
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	let step = $state(1);
	// svelte-ignore state_referenced_locally
	let draft = $state({
		title: '',
		description: '',
		type: initialType === 'meet' ? 'meeting' : 'design',
		clientId: defaultClientId || '',
		projectId: defaultProjectId || '',
		milestoneId: defaultMilestoneId || '',
		priority: defaultPriorityProp || 'medium',
		status: 'todo',
		dueDate: getInitialDueDate(),
		assigneeIds: [] as string[],
		tags: initialType === 'meet' ? ['#meeting'] : ([] as string[]),
		subtasks: [] as string[],
		isRecurring: false,
		recurringType: 'weekly' as 'daily' | 'weekly' | 'monthly' | 'yearly',
		recurringInterval: 1,
		recurringEndDate: '',
		meetTime: '10:00',
		meetDurationMinutes: 30
	});

	const selectedClientName = $derived(
		draft.clientId ? (clients.find((c) => c.id === draft.clientId)?.name ?? null) : null
	);

	function selectClient(id: string) {
		draft.clientId = id;
		clientPopoverOpen = false;
		clientSearch = '';
	}

	let tagInput = $state('');
	let subtaskInput = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	let dueDateOpen = $state(false);
	let recurringEndDateOpen = $state(false);

	const dueDateValue = $derived<DateValue | undefined>(parseIsoDate(draft.dueDate));
	const recurringEndDateValue = $derived<DateValue | undefined>(
		parseIsoDate(draft.recurringEndDate)
	);

	function parseIsoDate(s: string): DateValue | undefined {
		if (!s) return undefined;
		const [y, m, d] = s.split('-').map(Number);
		if (!y || !m || !d) return undefined;
		return new CalendarDate(y, m, d);
	}

	function formatIsoDate(v: DateValue): string {
		return `${v.year}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
	}

	function formatDisplayDate(s: string): string {
		if (!s) return '';
		const [y, m, d] = s.split('-').map(Number);
		if (!y || !m || !d) return s;
		return new Date(y, m - 1, d).toLocaleDateString('ro-RO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	function handleDueDateSelect(v: DateValue | undefined) {
		draft.dueDate = v ? formatIsoDate(v) : '';
		dueDateOpen = false;
	}

	function handleRecurringEndDateSelect(v: DateValue | undefined) {
		draft.recurringEndDate = v ? formatIsoDate(v) : '';
		recurringEndDateOpen = false;
	}

	const projects = $derived(
		draft.clientId
			? allProjects.filter((p: any) => !p.clientId || p.clientId === draft.clientId)
			: allProjects
	);

	// Fetch the client's team for both admin (after picking a client) AND the
	// client portal (clientId injected via defaultClientId from layout context).
	const clientUsersQuery = $derived(
		draft.clientId ? getAssignableClientUsers(draft.clientId) : null
	);
	const clientUsers = $derived(clientUsersQuery?.current ?? []);

	const agencyAssigneeOptions = $derived<AssigneeOption[]>(
		users.map((u: any) => ({
			value: u.id,
			label: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
			kind: 'agency' as const,
			email: u.email,
			phone: (u.whatsappPhone ?? u.phone) ?? null
		}))
	);

	const clientAssigneeOptions = $derived<AssigneeOption[]>(
		clientUsers.map((u: any) => ({
			value: u.id,
			label: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
			kind: 'client' as const,
			email: u.email,
			phone: u.phone ?? null
		}))
	);

	// Lookup for the summary on step 3 — must cover BOTH agency and client team,
	// otherwise client-side assignees fall through to raw IDs.
	const assigneeNameById = $derived(
		new Map<string, string>([
			...agencyAssigneeOptions.map((o) => [o.value, o.label] as [string, string]),
			...clientAssigneeOptions.map((o) => [o.value, o.label] as [string, string])
		])
	);

	const isMeet = $derived(draft.type === 'meeting');

	const calStatusQuery = $derived(isMeet ? getGoogleCalendarStatus() : null);
	const calStatus = $derived(calStatusQuery?.current);
	const tenantSlug = $derived(page.params.tenant ?? '');

	const canCreate = $derived(
		isClient
			? !!draft.title.trim()
			: !!draft.title.trim() && !!draft.clientId && draft.assigneeIds.length > 0
	);

	const step1Valid = $derived(
		isClient ? !!draft.title.trim() : !!draft.title.trim() && !!draft.clientId
	);
	const step2Valid = $derived(isClient ? true : draft.assigneeIds.length > 0);

	$effect(() => {
		if (open) {
			step = 1;
			draft.title = '';
			draft.description = '';
			draft.type = initialType === 'meet' ? 'meeting' : 'design';
			draft.clientId = defaultClientId || '';
			draft.projectId = defaultProjectId || '';
			draft.milestoneId = defaultMilestoneId || '';
			draft.priority = defaultPriorityProp || 'medium';
			// Client users always create as pending-approval; otherwise honor explicit defaultStatus, fall back to 'todo'.
			draft.status = isClient ? 'pending-approval' : defaultStatus || 'todo';
			draft.dueDate = getInitialDueDate();
			// Pre-select the creator as the default assignee in both modes — the
			// client picks teammates on top, or stays solo and the server falls back
			// to the agency owner if they deselect themselves.
			draft.assigneeIds = currentUserId ? [currentUserId] : [];
			draft.tags = initialType === 'meet' ? ['#meeting'] : [];
			draft.subtasks = [];
			draft.isRecurring = false;
			draft.recurringType = 'weekly';
			draft.recurringInterval = 1;
			draft.recurringEndDate = '';
			draft.meetTime = '10:00';
			draft.meetDurationMinutes = 30;
			tagInput = '';
			subtaskInput = '';
			error = null;
		}
	});

	// Prune selected assignees that are no longer valid for the current
	// client (e.g., user switched client in Step 1 — the previous client's
	// people are no longer assignable).
	$effect(() => {
		if (!open) return;
		const valid = new Set<string>([
			...agencyAssigneeOptions.map((o) => o.value),
			...clientAssigneeOptions.map((o) => o.value)
		]);
		// Client portal: the creator (currentUserId) is not in either list when
		// they're a clientUser of the same client but the picker filter has not
		// yet loaded — keep them whitelisted so the default doesn't get pruned.
		if (isClient && currentUserId) valid.add(currentUserId);
		const pruned = draft.assigneeIds.filter((id) => valid.has(id));
		if (pruned.length !== draft.assigneeIds.length) {
			draft.assigneeIds = pruned;
		}
	});

	function toggleAssignee(userId: string) {
		if (draft.assigneeIds.includes(userId)) {
			draft.assigneeIds = draft.assigneeIds.filter((id) => id !== userId);
		} else {
			draft.assigneeIds = [...draft.assigneeIds, userId];
		}
	}

	function addTag() {
		const t = tagInput.trim();
		if (!t) return;
		const tag = t.startsWith('#') ? t : `#${t}`;
		if (!draft.tags.includes(tag)) {
			draft.tags = [...draft.tags, tag];
		}
		tagInput = '';
	}

	function removeTag(tag: string) {
		draft.tags = draft.tags.filter((x) => x !== tag);
	}

	function addSubtask() {
		const t = subtaskInput.trim();
		if (!t) return;
		draft.subtasks = [...draft.subtasks, t];
		subtaskInput = '';
	}

	function removeSubtask(idx: number) {
		draft.subtasks = draft.subtasks.filter((_, i) => i !== idx);
	}

	function getUserInitials(user: { firstName: string; lastName: string; email: string }): string {
		const first = user.firstName?.charAt(0) || '';
		const last = user.lastName?.charAt(0) || '';
		return (first + last).toUpperCase() || user.email.charAt(0).toUpperCase();
	}

	function getUserColor(userId: string): string {
		const palette = [
			'#1877F2',
			'#8b5cf6',
			'#10b981',
			'#ec4899',
			'#f59e0b',
			'#06b6d4',
			'#ef4444',
			'#6366f1'
		];
		let hash = 0;
		for (let i = 0; i < userId.length; i++)
			hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff;
		return palette[Math.abs(hash) % palette.length];
	}

	const clientName = $derived(clients.find((c) => c.id === draft.clientId)?.name || '—');
	const priorityLabel = $derived(PRIORITIES.find((p) => p.id === draft.priority)?.label || '—');
	const statusLabel = $derived(
		draft.status === 'todo'
			? 'Todo'
			: draft.status === 'in-progress'
				? 'In Progress'
				: draft.status
	);

	async function handleCreate() {
		if (!canCreate) return;
		loading = true;
		error = null;
		try {
			const tagNames = draft.tags
				.map((t) => (t.startsWith('#') ? t.slice(1) : t))
				.filter(Boolean);
			await createTask({
				title: draft.title,
				description: draft.description || undefined,
				clientId: draft.clientId || undefined,
				projectId: draft.projectId || undefined,
				milestoneId: draft.milestoneId || undefined,
				status: (isClient ? 'pending-approval' : draft.status) as any,
				priority: draft.priority as any,
				dueDate: draft.dueDate || undefined,
				assignedToUserId: draft.assigneeIds[0] || undefined,
				assigneeUserIds: draft.assigneeIds.length ? draft.assigneeIds : undefined,
				isRecurring: draft.isRecurring || undefined,
				recurringType: draft.isRecurring ? (draft.recurringType as any) : undefined,
				recurringInterval: draft.isRecurring ? draft.recurringInterval : undefined,
				recurringEndDate:
					draft.isRecurring && draft.recurringEndDate ? draft.recurringEndDate : undefined,
				type: draft.type as any,
				meetTime:
					isMeet && draft.meetTime
						? `${draft.dueDate || localTodayIso()}T${draft.meetTime}`
						: undefined,
				meetDurationMinutes: isMeet ? draft.meetDurationMinutes : undefined,
				subtasks: draft.subtasks.length ? draft.subtasks : undefined,
				tagNames: tagNames.length ? tagNames : undefined
			}).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);
			onOpenChange(false);
			onSuccess?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'A apărut o eroare';
		} finally {
			loading = false;
		}
	}

	const STEPS = [
		{ n: 1, label: 'Detalii' },
		{ n: 2, label: 'Echipă & Plan' },
		{ n: 3, label: 'Subtaskuri & Final' }
	];
</script>

<Dialog bind:open {onOpenChange}>
	<DialogContent
		showCloseButton={false}
		class="flex flex-col gap-0 bg-white p-0 sm:max-w-[820px] max-h-[90vh] overflow-hidden"
	>
		<!-- Header -->
		<div class="flex items-center gap-3 border-b px-5 py-4">
			<span
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"
			>
				<PlusIcon class="h-4 w-4" />
			</span>
			<div class="min-w-0 flex-1">
				<h2 class="text-sm font-semibold leading-tight text-slate-900">
					{isMeet ? 'Meeting nou (Google Meet)' : 'Task nou'}
				</h2>
				<p class="mt-0.5 text-xs text-slate-500">
					{isMeet
						? 'Programează o întâlnire cu echipa'
						: 'Creează un task pentru echipă'} · Pasul {step}/3
				</p>
			</div>
			<button
				class="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
				onclick={() => onOpenChange(false)}
				aria-label="Închide"
			>
				<XIcon class="h-4 w-4" />
			</button>
		</div>

		<!-- Stepper -->
		<div class="flex gap-1.5 border-b bg-slate-50 px-5 py-3">
			{#each STEPS as s}
				<button
					class="flex flex-1 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all hover:bg-white/60
						{step === s.n ? 'bg-white text-slate-900 shadow-sm' : ''}
						{step > s.n ? 'text-emerald-600' : ''}
						{step < s.n ? 'text-slate-400' : ''}"
					onclick={() => {
						if (
							s.n < step ||
							(s.n === 2 && step1Valid) ||
							(s.n === 3 && step1Valid && step2Valid)
						) {
							step = s.n;
						}
					}}
				>
					<span
						class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold
							{step === s.n ? 'bg-blue-600 text-white' : ''}
							{step > s.n ? 'bg-emerald-500 text-white' : ''}
							{step < s.n ? 'bg-slate-200 text-slate-500' : ''}"
					>
						{#if step > s.n}
							<CheckIcon class="h-2.5 w-2.5" />
						{:else}
							{s.n}
						{/if}
					</span>
					<span>{s.label}</span>
				</button>
			{/each}
		</div>

		<!-- Body -->
		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
			{#if step === 1}
				<div class="grid grid-cols-2 gap-4">
					<!-- Title -->
					<div class="col-span-2 flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500">
							Titlu {isMeet ? 'meeting' : 'task'}
							<span class="text-red-500">*</span>
						</span>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							autofocus
							class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
							placeholder={isMeet
								? 'Ex: Sync săptămânal Heylux'
								: 'Ex: Materiale TikTok – campanie nouă'}
							bind:value={draft.title}
						/>
					</div>

					{#if isMeet}
						<!-- Meet time -->
						<div class="flex flex-col gap-1.5">
							<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
								>Oră început</span>
							<input
								type="time"
								class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
								bind:value={draft.meetTime}
							/>
						</div>
						<!-- Duration -->
						<div class="flex flex-col gap-1.5">
							<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
								>Durată</span>
							<div class="flex gap-1.5">
								{#each [15, 30, 45, 60] as dur}
									<button
										class="flex-1 rounded-lg border py-2 text-xs font-semibold transition-all
											{draft.meetDurationMinutes === dur
												? 'border-blue-500 bg-blue-50 text-blue-700'
												: 'border-slate-200 bg-white text-slate-500 hover:border-blue-300'}"
										onclick={() => (draft.meetDurationMinutes = dur)}
									>
										{dur < 60 ? dur + ' min' : '1 oră'}
									</button>
								{/each}
							</div>
						</div>
						<!-- Meet integration status banner — 2 state -->
						<div class="col-span-2">
							{#if !calStatus}
								<!-- loading or non-meeting — no banner -->
							{:else if !calStatus.connected}
								<div class="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
									<span class="mt-0.5 text-amber-600">⚠</span>
									<div class="text-xs text-amber-800">
										<strong>Conectează Google Calendar</strong> pentru a genera automat linkul Meet.
										<a href="/{tenantSlug}/settings/google-calendar" class="ml-1 font-semibold underline">Conectează</a>
									</div>
								</div>
							{:else}
								<div class="flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
									<span class="text-emerald-600">✓</span>
									<div class="text-xs text-emerald-800">
										<strong>Linkul Meet va fi generat automat</strong> când salvezi (cont {calStatus.email}).
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Description -->
					<div class="col-span-2 flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
							>Descriere</span>
						<Textarea
							class="min-h-[80px] resize-y text-sm"
							placeholder="Detalii, link-uri, brief..."
							bind:value={draft.description}
						/>
					</div>

					{#if !isClient}
						<!-- Client -->
						<div class="flex flex-col gap-1.5">
							<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500">
								Client <span class="text-red-500">*</span>
							</span>
							<Popover.Root bind:open={clientPopoverOpen}>
								<Popover.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											class="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
										>
											<span class={selectedClientName ? 'truncate text-slate-900' : 'text-slate-400'}>
												{selectedClientName ?? 'Alege client...'}
											</span>
											<ChevronDownIcon class="h-4 w-4 shrink-0 text-slate-400" />
										</button>
									{/snippet}
								</Popover.Trigger>
								<Popover.Content class="w-72 p-2" align="start">
									<div class="relative mb-2">
										<SearchIcon
											class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
										/>
										<Input
											bind:value={clientSearch}
											placeholder="Caută client..."
											class="h-8 pl-8 text-sm"
										/>
									</div>
									<div class="max-h-[220px] space-y-0.5 overflow-y-auto">
										{#each visibleClients as client (client.id)}
											<button
												type="button"
												class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 {draft.clientId ===
												client.id
													? 'bg-blue-50'
													: ''}"
												onclick={() => selectClient(client.id)}
											>
												<span class="truncate text-slate-700">{client.name}</span>
												{#if draft.clientId === client.id}
													<CheckIcon class="h-3.5 w-3.5 shrink-0 text-blue-600" />
												{/if}
											</button>
										{:else}
											<p class="px-2 py-3 text-center text-xs text-slate-400">Niciun client găsit</p>
										{/each}
									</div>
									{#if activeClientIds}
										<button
											type="button"
											class="mt-1.5 w-full rounded px-2 py-1 text-center text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
											onclick={() => (showAllClients = !showAllClients)}
										>
											{showAllClients
												? 'Doar clienți activi'
												: `Arată toți clienții (${clients.length})`}
										</button>
									{/if}
								</Popover.Content>
							</Popover.Root>
						</div>

						<!-- Project -->
						<div class="flex flex-col gap-1.5">
							<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
								>Proiect</span>
							<select
								class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
								bind:value={draft.projectId}
							>
								<option value="">Niciun proiect</option>
								{#each projects as project}
									<option value={project.id}>{project.name}</option>
								{/each}
							</select>
						</div>
					{/if}

					<!-- Type chips -->
					<div class="col-span-2 flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500">Tip</span>
						<div class="flex flex-wrap gap-1.5">
							{#each TYPES as t}
								<button
									class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all"
									style={draft.type === t.id
										? `border-color: ${t.color}; background: ${t.color}18; color: ${t.color};`
										: 'border-color: #d5dbe5; background: white; color: #475569;'}
									onclick={() => (draft.type = t.id)}
								>
									<span
										class="h-1.5 w-1.5 shrink-0 rounded-full"
										style="background: {t.color}"
									></span>
									{t.label}
								</button>
							{/each}
						</div>
					</div>
				</div>
			{:else if step === 2}
				<div class="grid grid-cols-2 gap-4">
					{#if !isClient || clientAssigneeOptions.length > 0}
						<!-- Assignees: agency + (optional) client team in admin; "Echipa ta" in client portal -->
						<div class="col-span-2 flex flex-col gap-2">
							<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500">
								{#if isClient}
									Echipa ta
								{:else}
									Responsabili <span class="text-red-500">*</span>
								{/if}
							</span>

							{#if !isClient}
								<!-- Agency section (admin only) -->
								<div class="flex flex-col gap-1">
									<div class="text-[10px] font-bold uppercase tracking-wide text-slate-400">
										Agenție
									</div>
									<div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
										{#each agencyAssigneeOptions as opt (opt.value)}
											{@const selected = draft.assigneeIds.includes(opt.value)}
											<button
												type="button"
												class="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-all
													{selected
														? 'border-blue-500 bg-blue-50 text-slate-900'
														: 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-slate-50'}"
												onclick={() => toggleAssignee(opt.value)}
											>
												<ContactAvatar
													src={avatarSrcFromPhone(opt.phone)}
													name={opt.label}
													phoneE164={opt.phone ?? null}
													size="sm"
												/>
												<span class="flex-1 truncate">{opt.label}</span>
												{#if selected}
													<span
														class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
													>
														<CheckIcon class="h-2.5 w-2.5" />
													</span>
												{/if}
											</button>
										{/each}
									</div>
								</div>
							{/if}

							<!-- Client team section: admin sees it as "Echipa {clientName}"; client portal sees it as the only section -->
							{#if clientAssigneeOptions.length > 0}
								<div class="mt-1 flex flex-col gap-1">
									{#if !isClient}
										<div class="text-[10px] font-bold uppercase tracking-wide text-slate-400">
											Echipa {clientName}
										</div>
									{/if}
									<div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
										{#each clientAssigneeOptions as opt (opt.value)}
											{@const selected = draft.assigneeIds.includes(opt.value)}
											<button
												type="button"
												class="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-all
													{selected
														? 'border-emerald-500 bg-emerald-50 text-slate-900'
														: 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/40'}"
												onclick={() => toggleAssignee(opt.value)}
											>
												<ContactAvatar
													src={avatarSrcFromPhone(opt.phone)}
													name={opt.label}
													phoneE164={opt.phone ?? null}
													size="sm"
													class="ring-2 ring-emerald-100"
												/>
												<span class="flex-1 truncate">{opt.label}</span>
												{#if selected}
													<span
														class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
													>
														<CheckIcon class="h-2.5 w-2.5" />
													</span>
												{/if}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Priority -->
					<div class="flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
							>Prioritate</span>
						<div class="flex flex-wrap gap-1.5">
							{#each PRIORITIES as p}
								<button
									class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all"
									style={draft.priority === p.id
										? `border-color: ${p.color}; background: ${p.color}18; color: ${p.color};`
										: 'border-color: #d5dbe5; background: white; color: #475569;'}
									onclick={() => (draft.priority = p.id)}
								>
									<span
										class="h-2 w-2 shrink-0 rounded-full"
										style="background: {p.color}"
									></span>
									{p.label}
								</button>
							{/each}
						</div>
					</div>

					<!-- Status -->
					{#if !isClient}
						<div class="flex flex-col gap-1.5">
							<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
								>Status inițial</span>
							<div class="flex gap-1.5">
								{#each STATUSES_CREATE as s}
									<button
										class="flex-1 rounded-lg border py-2 text-xs font-semibold transition-all
											{draft.status === s.id
												? 'border-blue-500 bg-blue-50 text-blue-700'
												: 'border-slate-200 bg-white text-slate-500 hover:border-blue-300'}"
										onclick={() => (draft.status = s.id)}
									>
										{s.label}
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Due date -->
					<div class="flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
							>Deadline</span>
						<Popover.Root bind:open={dueDateOpen}>
							<Popover.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										type="button"
										class="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 transition-colors hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
									>
										<CalendarIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
										<span class={draft.dueDate ? '' : 'text-slate-400'}>
											{draft.dueDate ? formatDisplayDate(draft.dueDate) : 'Selectează data'}
										</span>
									</button>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content class="w-auto p-0" align="start">
								<div class="flex flex-col">
									<Calendar
										type="single"
										value={dueDateValue}
										onValueChange={handleDueDateSelect}
										locale="ro-RO"
									/>
									{#if draft.dueDate}
										<Button
											variant="ghost"
											class="rounded-t-none border-t text-sm text-muted-foreground"
											onclick={() => {
												draft.dueDate = '';
												dueDateOpen = false;
											}}
										>
											Șterge data
										</Button>
									{/if}
								</div>
							</Popover.Content>
						</Popover.Root>
					</div>

					<!-- Recurring -->
					<div class="flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
							>Recurență</span>
						<label
							class="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
						>
							<Switch bind:checked={draft.isRecurring} disabled={!draft.dueDate} />
							<span class="text-xs text-slate-600">Task recurent</span>
						</label>
					</div>

					{#if draft.isRecurring}
						<div
							class="col-span-2 grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
						>
							<div class="flex flex-col gap-1">
								<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
									>Frecvență</span>
								<select
									class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
									bind:value={draft.recurringType}
								>
									<option value="daily">Zilnic</option>
									<option value="weekly">Săptămânal</option>
									<option value="monthly">Lunar</option>
									<option value="yearly">Anual</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
									>La fiecare</span>
								<Input type="number" min="1" max="365" bind:value={draft.recurringInterval} />
							</div>
							<div class="col-span-2 flex flex-col gap-1">
								<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
									>Data sfârșit (opțional)</span>
								<Popover.Root bind:open={recurringEndDateOpen}>
									<Popover.Trigger>
										{#snippet child({ props })}
											<button
												{...props}
												type="button"
												class="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 transition-colors hover:border-blue-300 focus:border-blue-500 focus:outline-none"
											>
												<CalendarIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
												<span class={draft.recurringEndDate ? '' : 'text-slate-400'}>
													{draft.recurringEndDate
														? formatDisplayDate(draft.recurringEndDate)
														: 'Selectează data'}
												</span>
											</button>
										{/snippet}
									</Popover.Trigger>
									<Popover.Content class="w-auto p-0" align="start">
										<div class="flex flex-col">
											<Calendar
												type="single"
												value={recurringEndDateValue}
												onValueChange={handleRecurringEndDateSelect}
												locale="ro-RO"
											/>
											{#if draft.recurringEndDate}
												<Button
													variant="ghost"
													class="rounded-t-none border-t text-sm text-muted-foreground"
													onclick={() => {
														draft.recurringEndDate = '';
														recurringEndDateOpen = false;
													}}
												>
													Șterge data
												</Button>
											{/if}
										</div>
									</Popover.Content>
								</Popover.Root>
							</div>
						</div>
					{/if}

					<!-- Tags -->
					<div class="col-span-2 flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
							>Tag-uri</span>
						<div class="flex gap-2">
							<input
								class="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
								placeholder="Adaugă tag și apasă Enter"
								bind:value={tagInput}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										addTag();
									}
								}}
							/>
							<button
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-400 hover:text-blue-600"
								onclick={addTag}
							>
								<PlusIcon class="h-3.5 w-3.5" />
							</button>
						</div>
						<div class="flex min-h-[28px] flex-wrap gap-1.5">
							{#each draft.tags as tag}
								<span
									class="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
								>
									{tag}
									<button
										onclick={() => removeTag(tag)}
										class="ml-0.5 text-blue-400 hover:text-blue-700"
									>
										<XIcon class="h-2.5 w-2.5" />
									</button>
								</span>
							{:else}
								<span class="text-xs text-slate-400">Niciun tag</span>
							{/each}
						</div>
					</div>
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-4">
					<!-- Subtasks -->
					<div class="flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500">
							Subtaskuri ({draft.subtasks.length})
						</span>
						<div class="flex gap-2">
							<input
								class="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
								placeholder="Ex: Pregătire brief, Filmare, Editare..."
								bind:value={subtaskInput}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										addSubtask();
									}
								}}
							/>
							<button
								class="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-400 hover:text-blue-600"
								onclick={addSubtask}
							>
								<PlusIcon class="h-3 w-3" /> Adaugă
							</button>
						</div>
						<div class="flex min-h-[40px] flex-col gap-1">
							{#each draft.subtasks as sub, i}
								<div
									class="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2"
								>
									<span
										class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500"
										>{i + 1}</span
									>
									<span class="flex-1 text-sm text-slate-800">{sub}</span>
									<button
										onclick={() => removeSubtask(i)}
										class="text-slate-300 transition-colors hover:text-red-500"
									>
										<XIcon class="h-3.5 w-3.5" />
									</button>
								</div>
							{:else}
								<div
									class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs text-slate-400"
								>
									Niciun subtask. Sparge task-ul mare în pași mici.
								</div>
							{/each}
						</div>
					</div>

					<!-- Attachments stub -->
					<div class="flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
							>Atașamente</span>
						<div
							class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 py-6 text-xs text-slate-400"
						>
							<span class="text-base">📎</span>
							<div class="text-center">
								<strong class="text-slate-500">Trage fișiere aici</strong>
								<p class="mt-0.5">sau click pentru a selecta · max 25MB</p>
							</div>
						</div>
					</div>

					<!-- Summary -->
					<div class="flex flex-col gap-1.5">
						<span class="text-[11px] font-bold uppercase tracking-wide text-slate-500"
							>Sumar task</span>
						<div
							class="flex flex-col divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm"
						>
							<div class="flex items-center justify-between px-4 py-2.5">
								<span class="text-slate-500">Titlu</span>
								<strong class="text-slate-900">{draft.title || '—'}</strong>
							</div>
							<div class="flex items-center justify-between px-4 py-2.5">
								<span class="text-slate-500">Client</span>
								<strong class="text-slate-900">{clientName}</strong>
							</div>
							<div class="flex items-center justify-between px-4 py-2.5">
								<span class="text-slate-500">Responsabili</span>
								<strong class="truncate text-slate-900">
									{draft.assigneeIds.length > 0
										? draft.assigneeIds
												.map((id) => assigneeNameById.get(id) ?? id)
												.join(', ')
										: '—'}
								</strong>
							</div>
							<div class="flex items-center justify-between px-4 py-2.5">
								<span class="text-slate-500">Prioritate · Status</span>
								<strong class="text-slate-900">{priorityLabel} · {statusLabel}</strong>
							</div>
							<div class="flex items-center justify-between px-4 py-2.5">
								<span class="text-slate-500">Deadline</span>
								<strong class="text-slate-900">{draft.dueDate || 'fără termen'}</strong>
							</div>
							<div class="flex items-center justify-between px-4 py-2.5">
								<span class="text-slate-500">Subtaskuri · Tag-uri</span>
								<strong class="text-slate-900"
									>{draft.subtasks.length} subtaskuri · {draft.tags.length} tag-uri</strong
								>
							</div>
						</div>
					</div>
				</div>
			{/if}

			{#if error}
				<div class="mt-3 rounded-lg bg-red-50 px-4 py-3">
					<p class="text-sm text-red-700">{error}</p>
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-between border-t bg-white px-5 py-3">
			<button
				class="text-sm text-slate-500 transition-colors hover:text-slate-700"
				onclick={() => onOpenChange(false)}
			>
				Anulează
			</button>
			<div class="flex items-center gap-2">
				{#if step > 1}
					<Button variant="outline" size="sm" onclick={() => (step -= 1)}>
						<ChevronLeftIcon class="mr-1 h-3.5 w-3.5" /> Înapoi
					</Button>
				{/if}
				{#if step < 3}
					<Button
						size="sm"
						disabled={step === 1 ? !step1Valid : !step2Valid}
						onclick={() => (step += 1)}
					>
						Continuă <ChevronRightIcon class="ml-1 h-3.5 w-3.5" />
					</Button>
				{:else}
					<Button size="sm" disabled={!canCreate || loading} onclick={handleCreate}>
						{#if loading}
							Se creează...
						{:else}
							<CheckIcon class="mr-1 h-3.5 w-3.5" /> Creează task
						{/if}
					</Button>
				{/if}
			</div>
		</div>
	</DialogContent>
</Dialog>
