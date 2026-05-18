<!-- src/lib/components/client-task/client-task-rail.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import ClientTaskMetaCard from './client-task-meta-card.svelte';
	import ClientTaskProgressCard from './client-task-progress-card.svelte';
	import ClientTaskTeamCard from './client-task-team-card.svelte';
	import ClientTaskMaterialsCard from './client-task-materials-card.svelte';
	import ClientTaskActivityCard from './client-task-activity-card.svelte';
	import type { LightboxImage } from './client-task-lightbox.svelte';

	type Subtask = { id: string; title: string; done: number | boolean; position: number };
	type Assignee = {
		id: string;
		firstName?: string | null;
		lastName?: string | null;
		email?: string | null;
		displayName?: string | null;
		online?: boolean;
	};

	type Props = {
		task: Task;
		subtasks: Subtask[];
		assignees: Assignee[];
		createdByName: string | null;
		readonlyTeam?: boolean;
		onOpenLightbox: (images: LightboxImage[], startIndex: number) => void;
	};

	let {
		task,
		subtasks,
		assignees,
		createdByName,
		readonlyTeam = false,
		onOpenLightbox
	}: Props = $props();
</script>

<aside class="ct-rail flex flex-col gap-3.5">
	<ClientTaskMetaCard {task} {createdByName} />
	<ClientTaskProgressCard taskId={task.id} {subtasks} />
	<ClientTaskTeamCard {assignees} readonly={readonlyTeam} />
	<ClientTaskMaterialsCard taskId={task.id} {onOpenLightbox} />
	<ClientTaskActivityCard taskId={task.id} />
</aside>
