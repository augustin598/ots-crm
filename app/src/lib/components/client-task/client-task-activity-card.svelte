<!-- src/lib/components/client-task/client-task-activity-card.svelte -->
<script lang="ts">
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RepeatIcon from '@lucide/svelte/icons/repeat';

	type Props = { taskId: string };
	let { taskId }: Props = $props();

	const activityQuery = $derived(getTaskActivities(taskId));
	const activities = $derived(activityQuery.current ?? []);

	function fmtDate(d: Date | string): string {
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	type ActivityKind = 'comment' | 'create' | 'update';

	function activityKind(action: string): ActivityKind {
		if (action === 'comment_added') return 'comment';
		if (action === 'created') return 'create';
		return 'update';
	}

	const FIELD_LABEL: Record<string, string> = {
		status: 'status',
		priority: 'prioritate',
		title: 'titlu',
		description: 'descriere',
		dueDate: 'data scadentă',
		startDate: 'data de început',
		assignee: 'echipa',
		assignees: 'echipa',
		assignedToUserId: 'responsabil',
		tag: 'tag',
		subtask: 'subtask',
		clientId: 'client',
		projectId: 'proiect',
		milestoneId: 'milestone',
		isRecurring: 'recurență',
		recurringType: 'tip recurență',
		recurringInterval: 'interval recurență'
	};

	function fieldLabelFor(action: string, field: string | null): string {
		if (field && FIELD_LABEL[field]) return FIELD_LABEL[field];
		switch (action) {
			case 'status_changed':
				return 'status';
			case 'assignee_added':
			case 'assignee_removed':
				return 'echipa';
			case 'tag_added':
			case 'tag_removed':
				return 'tag';
			case 'subtask_added':
			case 'subtask_removed':
				return 'subtask';
			case 'meet_event_created':
			case 'meet_event_updated':
			case 'meet_event_deleted':
			case 'meet_event_failed':
			case 'meet_event_orphaned':
				return 'meeting';
			default:
				return field ?? 'task';
		}
	}

	function looksLikeLongText(v: string | null | undefined): boolean {
		return !!v && v.length > 60;
	}

	// CRM IDs are encodeBase32LowerCase(15 bytes) → 24 lowercase alphanumeric chars.
	// Suppress raw IDs from the diff line — they're meaningless to clients.
	function looksLikeOpaqueId(v: string | null | undefined): boolean {
		if (!v) return false;
		if (v.length < 18 || v.length > 36) return false;
		return /^[a-z0-9]+$/.test(v);
	}

	function displayDiffValue(v: string | null | undefined): string {
		if (!v) return '';
		if (looksLikeOpaqueId(v)) return '—';
		return v;
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3.5 flex items-center gap-2">
		<span class="grid h-7 w-7 place-items-center rounded-[7px] bg-[#f1f5f9] text-[#475569]">
			<ClockIcon class="h-3.5 w-3.5" />
		</span>
		<h3 class="text-[15px] font-bold text-[#0f172a]">
			Activitate ({activities.length})
		</h3>
	</div>

	{#if activities.length === 0}
		<div class="text-[12px] text-[#94a3b8]">Nicio activitate încă.</div>
	{:else}
		<ul class="ct-act-list flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1">
			{#each activities as a (a.id)}
				{@const kind = activityKind(a.action)}
				{@const who = a.userName?.trim() || 'Cineva'}
				<li class="ct-act flex gap-2.5">
					<div
						class={[
							'ct-act-icon grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full',
							kind === 'comment'
								? 'bg-[#dbeafe] text-[#1877F2]'
								: 'bg-[#f1f5f9] text-[#64748b]'
						].join(' ')}
					>
						{#if kind === 'comment'}
							<MessageCircleIcon class="h-3 w-3" />
						{:else if kind === 'create'}
							<PlusIcon class="h-3 w-3" />
						{:else}
							<RepeatIcon class="h-3 w-3" />
						{/if}
					</div>
					<div class="ct-act-body min-w-0 flex-1 text-[12.5px] leading-[1.5] text-[#475569]">
						{#if kind === 'comment'}
							<div><strong class="font-bold text-[#0f172a]">{who}</strong> a adăugat un comentariu</div>
						{:else if kind === 'create'}
							<div><strong class="font-bold text-[#0f172a]">{who}</strong> a creat task-ul</div>
						{:else}
							<div>
								<strong class="font-bold text-[#0f172a]">{who}</strong>
								a actualizat
								<span class="ct-act-field font-semibold text-[#1877F2]">
									{fieldLabelFor(a.action, a.field)}
								</span>
							</div>
							{#if a.oldValue && a.newValue && !looksLikeLongText(a.newValue) && !looksLikeLongText(a.oldValue) && !(looksLikeOpaqueId(a.oldValue) && looksLikeOpaqueId(a.newValue))}
								<div
									class="ct-act-diff mt-[3px] flex items-center gap-1.5 font-mono text-[11.5px] text-[#64748b]"
								>
									<span class="truncate">{displayDiffValue(a.oldValue)}</span>
									<span class="ct-act-arrow text-[#cbd5e1]">→</span>
									<span class="truncate">{displayDiffValue(a.newValue)}</span>
								</div>
							{:else if a.newValue && !looksLikeLongText(a.newValue) && !looksLikeOpaqueId(a.newValue) && fieldLabelFor(a.action, a.field) !== 'descriere'}
								<div
									class="ct-act-diff mt-[3px] font-mono text-[11.5px] text-[#64748b]"
								>
									{a.newValue}
								</div>
							{:else if a.newValue && looksLikeLongText(a.newValue)}
								<div
									class="ct-act-preview mt-1 truncate rounded-md bg-[#f7f8fa] px-2.5 py-1.5 text-[11.5px] text-[#64748b]"
								>
									{a.newValue}
								</div>
							{/if}
						{/if}
						<div class="ct-act-time mt-[3px] text-[11px] text-[#94a3b8]">
							{fmtDate(a.createdAt)}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
