<script lang="ts">
	import { fly } from 'svelte/transition';
	import { Button } from '$lib/components/ui/button';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';

	type Props = {
		count: number;
		/** Count of selected tasks already in `done`/`cancelled` — warns user that Pause will be a no-op for them. */
		inactiveCount?: number;
		onPause?: () => void;
		onDuplicate?: () => void;
		onDelete?: () => void;
		onClear?: () => void;
		busy?: boolean;
	};

	let {
		count,
		inactiveCount = 0,
		onPause,
		onDuplicate,
		onDelete,
		onClear,
		busy = false
	}: Props = $props();
</script>

{#if count > 0}
	<div
		class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
		transition:fly={{ y: 24, duration: 220 }}
	>
		<div
			class="pointer-events-auto flex items-center gap-3 rounded-xl border border-[#e5e9f0] bg-white px-4 py-2.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)] dark:border-zinc-700 dark:bg-zinc-900"
			role="region"
			aria-label="Bulk task actions"
		>
			<div class="flex items-center gap-2">
				<span
					class="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full bg-[#1877F2] px-2 text-xs font-bold text-white"
				>
					{count}
				</span>
				<span class="text-sm font-medium text-[#0f172a] dark:text-zinc-100">
					{count === 1 ? 'task selectat' : 'task-uri selectate'}
				</span>
				{#if inactiveCount > 0}
					<span
						class="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold text-[#b45309]"
						title="Pause won't affect tasks that are already done/cancelled"
					>
						{inactiveCount} inactive
					</span>
				{/if}
			</div>

			<div class="h-6 w-px bg-[#e5e9f0]"></div>

			<div class="flex items-center gap-1.5">
				<Button
					variant="outline"
					size="sm"
					disabled={busy || !onPause}
					onclick={() => onPause?.()}
					class="gap-1.5"
				>
					<PauseIcon class="h-3.5 w-3.5" />
					Pause
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy || !onDuplicate}
					onclick={() => onDuplicate?.()}
					class="gap-1.5"
				>
					<CopyIcon class="h-3.5 w-3.5" />
					Duplicate
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy || !onDelete}
					onclick={() => onDelete?.()}
					class="gap-1.5 text-destructive hover:text-destructive"
				>
					<Trash2Icon class="h-3.5 w-3.5" />
					Delete
				</Button>
			</div>

			<button
				type="button"
				class="ml-1 grid h-7 w-7 place-items-center rounded-md text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
				onclick={() => onClear?.()}
				aria-label="Clear selection"
				disabled={busy}
			>
				<XIcon class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>
{/if}
