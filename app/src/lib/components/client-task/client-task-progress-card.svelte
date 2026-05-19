<!-- src/lib/components/client-task/client-task-progress-card.svelte -->
<script lang="ts">
	import {
		toggleSubtask,
		addSubtask,
		deleteSubtask,
		getTask
	} from '$lib/remotes/tasks.remote';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckSquare2Icon from '@lucide/svelte/icons/check-square-2';

	type Subtask = { id: string; title: string; done: number | boolean; position: number };

	type Props = {
		taskId: string;
		subtasks: Subtask[];
	};

	let { taskId, subtasks }: Props = $props();

	let newTitle = $state('');
	let pending = $state<Record<string, boolean>>({});

	const done = $derived(subtasks.filter((s) => !!s.done).length);
	const total = $derived(subtasks.length);
	const pct = $derived(total === 0 ? 0 : Math.round((done / total) * 100));

	async function handleToggle(s: Subtask) {
		pending = { ...pending, [s.id]: true };
		try {
			await toggleSubtask({ subtaskId: s.id, done: !s.done }).updates(getTask(taskId));
		} finally {
			const { [s.id]: _, ...rest } = pending;
			pending = rest;
		}
	}

	async function handleAdd(e: SubmitEvent) {
		e.preventDefault();
		const title = newTitle.trim();
		if (!title) return;
		newTitle = '';
		await addSubtask({ taskId, title }).updates(getTask(taskId));
	}

	async function handleDelete(s: Subtask) {
		if (!confirm(`Ștergi subtask "${s.title}"?`)) return;
		await deleteSubtask(s.id).updates(getTask(taskId));
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-1 flex items-center gap-2">
		<span class="grid h-7 w-7 place-items-center rounded-[7px] bg-[#f1f5f9] text-[#475569]">
			<CheckSquare2Icon class="h-3.5 w-3.5" />
		</span>
		<h3 class="text-[15px] font-bold text-[#0f172a]">
			Progres ({done}/{total})
		</h3>
	</div>

	<div class="ct-progress-bar h-2 overflow-hidden rounded-full bg-[#f1f5f9]">
		<div
			class="ct-progress-fill h-full rounded-full transition-[width] duration-300"
			style:width={`${pct}%`}
			style:background="linear-gradient(90deg, #1877F2, #10b981)"
		></div>
	</div>
	<div class="ct-progress-meta mt-1.5 flex justify-between text-[11px] text-[#94a3b8]">
		<span>{pct}% complet</span>
		<span>{total - done} rămase</span>
	</div>

	<ul class="mt-3 flex flex-col">
		{#each subtasks as s (s.id)}
			{@const isDone = !!s.done}
			<li
				class={`ct-subtask group flex items-center gap-2.5 border-b border-[#f1f5f9] py-2 last:border-b-0 ${isDone ? 'done' : ''}`}
			>
				<input
					type="checkbox"
					checked={isDone}
					disabled={pending[s.id]}
					onchange={() => handleToggle(s)}
					class="h-4 w-4 cursor-pointer rounded border-[1.5px] border-[#cbd5e1] accent-[#10b981]"
					aria-label={`Toggle ${s.title}`}
				/>
				<span
					class={`flex-1 text-[13px] ${isDone ? 'text-[#94a3b8] line-through' : 'text-[#0f172a]'}`}
				>
					{s.title}
				</span>
				<button
					type="button"
					class="text-[#94a3b8] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#ef4444]"
					onclick={() => handleDelete(s)}
					aria-label={`Șterge ${s.title}`}
				>
					<XIcon class="h-3.5 w-3.5" />
				</button>
			</li>
		{/each}
	</ul>

	<form onsubmit={handleAdd} class="mt-3 flex items-center gap-2">
		<input
			type="text"
			bind:value={newTitle}
			placeholder="Adaugă subtask..."
			class="flex-1 rounded-[7px] border border-[#d5dbe5] bg-white px-2.5 py-1.5 text-[12.5px] text-[#0f172a] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
		/>
		<button
			type="submit"
			disabled={!newTitle.trim()}
			class="grid h-7 w-7 place-items-center rounded-[7px] bg-[#1877F2] text-white transition-colors hover:bg-[#0d5cc7] disabled:opacity-50"
			aria-label="Adaugă subtask"
		>
			<PlusIcon class="h-3.5 w-3.5" />
		</button>
	</form>
</div>
