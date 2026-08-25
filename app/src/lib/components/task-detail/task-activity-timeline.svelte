<script lang="ts">
	import {
		Plus,
		MessageSquare,
		Check,
		X,
		ArrowRight,
		UserCheck,
		RefreshCw,
		Video,
		AlertTriangle
	} from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { getActivityValueColor } from '$lib/components/task-kanban-utils';

	interface Props {
		activities: any[];
		userMap: Map<string, string>;
		clientMap: Map<string, string>;
		projectMap: Map<string, string>;
	}

	let { activities, userMap, clientMap, projectMap }: Props = $props();

	const fieldLabels: Record<string, string> = {
		title: 'titlul',
		description: 'descrierea',
		status: 'statusul',
		priority: 'prioritatea',
		assignedToUserId: 'responsabilul',
		dueDate: 'termenul limită',
		clientId: 'clientul',
		projectId: 'proiectul',
		milestoneId: 'milestone-ul',
		isRecurring: 'recurența',
		recurringType: 'frecvența',
		recurringInterval: 'intervalul',
		recurringEndDate: 'sfârșitul recurenței'
	};

	function getActivityVerb(activity: { action: string; field?: string | null }): string {
		switch (activity.action) {
			case 'created':
				return 'a creat acest task';
			case 'commented':
				return 'a adăugat un comentariu';
			case 'approved':
				return 'a aprobat task-ul';
			case 'rejected':
				return 'a respins task-ul';
			case 'status_changed':
				return 'a schimbat statusul';
			case 'assigned':
				return 'a schimbat responsabilul';
			case 'updated':
				return activity.field
					? `a actualizat ${fieldLabels[activity.field] || activity.field}`
					: 'a actualizat task-ul';
			case 'meet_event_created':
				return 'a creat evenimentul în Google Calendar';
			case 'meet_event_updated':
				return 'a actualizat evenimentul din Google Calendar';
			case 'meet_event_deleted':
				return 'a șters evenimentul din Google Calendar';
			case 'meet_event_orphaned':
				return 'a creat evenimentul, dar linkul Meet încă se genera';
			case 'meet_event_failed':
				return 'nu a putut crea evenimentul în Google Calendar';
			case 'recurring_spawned':
				return 'a generat următoarea ocurență recurentă';
			case 'recurring_chain_ended':
				return 'a încheiat seria recurentă (s-a atins data de final)';
			case 'recurring_occurrences_skipped':
				return 'a sărit peste ocurențele ratate';
			case 'recurring_occurrence_rolled':
				return 'a mutat scadența pe perioada curentă';
			case 'whatsapp_group_linked':
				return 'a legat task-ul de un grup WhatsApp';
			case 'whatsapp_group_unlinked':
				return 'a dezlegat task-ul de grupul WhatsApp';
			default:
				return activity.action;
		}
	}

	/**
	 * `meet_event_*` rows carry a JSON payload, not a plain value. Rendering it raw
	 * (the old default branch) put `{"stage":"schedule","error":"..."}` in a badge,
	 * which is why a two-day Calendar outage went unnoticed. Pull out the human
	 * message and the console link instead.
	 */
	function meetDetail(
		activity: { action: string; newValue?: string | null }
	): { message: string; actionUrl: string | null } | null {
		if (!activity.action?.startsWith('meet_event_') || !activity.newValue) return null;
		try {
			const parsed = JSON.parse(activity.newValue);
			const message = parsed.message || parsed.error || parsed.reason || null;
			if (!message) return null;
			return {
				message: String(message),
				actionUrl: typeof parsed.actionUrl === 'string' ? parsed.actionUrl : null
			};
		} catch {
			return null;
		}
	}

	/**
	 * `recurring_*` catch-up rows carry a JSON payload too. Spell out how many
	 * periods went by unfinished and where the deadline landed — the raw badges
	 * would otherwise show an ISO timestamp next to a bare number.
	 */
	function recurringDetail(
		activity: { action: string; newValue?: string | null }
	): string | null {
		if (!activity.newValue) return null;
		if (
			activity.action !== 'recurring_occurrence_rolled' &&
			activity.action !== 'recurring_occurrences_skipped'
		) {
			return null;
		}
		try {
			const parsed = JSON.parse(activity.newValue);
			const count = Number(parsed.missed ?? parsed.skipped ?? 0);
			const to = parsed.to ? formatActivityDate(parsed.to) : null;
			if (!to) return null;
			const plural = count === 1 ? 'ocurență ratată' : 'ocurențe ratate';
			return count > 0
				? `${count} ${plural} — scadența nouă: ${to}`
				: `Scadența nouă: ${to}`;
		} catch {
			return null;
		}
	}

	function formatActivityDate(iso: string): string | null {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return null;
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	function resolveActivityValue(
		field: string | null | undefined,
		value: string | null | undefined
	): string {
		if (!value) return '';
		if (!field) return value;
		switch (field) {
			case 'clientId':
				return clientMap.get(value) || value;
			case 'assignedToUserId':
				return userMap.get(value) || value;
			case 'projectId':
				return projectMap.get(value) || value;
			default:
				return value;
		}
	}

	function getActivityIconColor(action: string): string {
		switch (action) {
			case 'created':
				return 'bg-green-100 text-green-600';
			case 'commented':
				return 'bg-blue-100 text-blue-600';
			case 'approved':
				return 'bg-emerald-100 text-emerald-600';
			case 'rejected':
				return 'bg-red-100 text-red-600';
			case 'status_changed':
				return 'bg-purple-100 text-purple-600';
			case 'assigned':
				return 'bg-amber-100 text-amber-600';
			case 'meet_event_created':
			case 'meet_event_updated':
				return 'bg-emerald-100 text-emerald-600';
			case 'meet_event_failed':
				return 'bg-red-100 text-red-600';
			case 'meet_event_orphaned':
				return 'bg-amber-100 text-amber-600';
			case 'whatsapp_group_linked':
			case 'whatsapp_group_unlinked':
				return 'bg-green-100 text-green-700';
			case 'recurring_spawned':
			case 'recurring_occurrences_skipped':
			case 'recurring_occurrence_rolled':
			case 'recurring_chain_ended':
				return 'bg-violet-100 text-violet-600';
			case 'meet_event_deleted':
				return 'bg-gray-200 text-gray-600';
			default:
				return 'bg-gray-100 text-gray-600';
		}
	}

	function timeAgo(date: Date | string): string {
		const now = new Date();
		const d = new Date(date);
		const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
		if (diff < 60) return 'acum';
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}z`;
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

{#if activities.length === 0}
	<p class="text-sm text-muted-foreground">Nicio activitate înregistrată.</p>
{:else}
	<div class="relative max-h-[300px] overflow-y-auto">
		<div class="absolute top-0 bottom-0 left-[15px] w-px bg-border"></div>
		<div class="space-y-3">
			{#each activities as activity (activity.id)}
				{@const actorName = activity.userName || userMap.get(activity.userId) || activity.userId}
				{@const meet = meetDetail(activity)}
				{@const recurring = recurringDetail(activity)}
				<div class="relative flex items-start gap-3">
					<div
						class="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full {getActivityIconColor(activity.action)}"
					>
						{#if activity.action === 'created'}
							<Plus class="h-3 w-3" />
						{:else if activity.action === 'commented'}
							<MessageSquare class="h-3 w-3" />
						{:else if activity.action === 'approved'}
							<Check class="h-3 w-3" />
						{:else if activity.action === 'rejected'}
							<X class="h-3 w-3" />
						{:else if activity.action === 'status_changed'}
							<ArrowRight class="h-3 w-3" />
						{:else if activity.action === 'assigned'}
							<UserCheck class="h-3 w-3" />
						{:else if activity.action === 'meet_event_failed'}
							<AlertTriangle class="h-3 w-3" />
						{:else if activity.action?.startsWith('meet_event_')}
							<Video class="h-3 w-3" />
						{:else}
							<RefreshCw class="h-3 w-3" />
						{/if}
					</div>
					<div class="min-w-0 flex-1 pt-0.5">
						<p class="text-xs">
							<span class="font-medium">{actorName}</span>
							<span class="text-muted-foreground"> {getActivityVerb(activity)}</span>
						</p>
						{#if meet}
							<p
								class="mt-1 text-xs {activity.action === 'meet_event_failed'
									? 'text-red-600'
									: 'text-muted-foreground'}"
							>
								{meet.message}
								{#if meet.actionUrl}
									<a
										href={meet.actionUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="ml-1 underline hover:text-foreground">Deschide</a
									>
								{/if}
							</p>
						{:else if recurring}
							<p class="mt-1 text-xs text-muted-foreground">{recurring}</p>
						{:else if activity.oldValue || activity.newValue}
							<div class="mt-0.5 flex flex-wrap items-center gap-1">
								{#if activity.oldValue}
									<Badge
										variant="outline"
										class="text-xs font-normal {getActivityValueColor(activity.field, activity.oldValue)}"
										>{resolveActivityValue(activity.field, activity.oldValue)}</Badge
									>
								{/if}
								{#if activity.oldValue && activity.newValue}
									<ArrowRight class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
								{/if}
								{#if activity.newValue}
									<Badge
										variant="secondary"
										class="text-xs font-normal {getActivityValueColor(activity.field, activity.newValue)}"
										>{resolveActivityValue(activity.field, activity.newValue)}</Badge
									>
								{/if}
							</div>
						{/if}
						<p class="mt-0.5 text-xs text-muted-foreground">{timeAgo(activity.createdAt)}</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
