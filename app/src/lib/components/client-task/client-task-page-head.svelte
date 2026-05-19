<!-- src/lib/components/client-task/client-task-page-head.svelte -->
<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';

	type Props = {
		clientName: string | null;
		onBack: () => void;
		onScheduleMeet: () => void;
	};

	let { clientName, onBack, onScheduleMeet }: Props = $props();
</script>

<div class="ct-page-head mb-3.5 flex items-center justify-between gap-3">
	<div
		class="ct-crumb-tag text-[11.5px] font-bold uppercase tracking-[0.06em] text-[#94a3b8]"
	>
		Task{clientName ? ` · ${clientName}` : ''}
	</div>

	<div class="flex shrink-0 items-center gap-2">
		<button
			type="button"
			class="ct-meet-btn inline-flex items-center gap-2 rounded-lg border border-[#e5e9f0] bg-white px-3.5 py-[7px] text-[12.5px] font-semibold text-[#0f172a] transition-colors hover:border-[#1877F2] hover:bg-[#f7faff]"
			onclick={onScheduleMeet}
		>
			<span
				class="ct-meet-icon grid h-6 w-6 place-items-center rounded-md border border-[#e5e9f0] bg-white"
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path d="M16 8.5V12.5L20 16V5L16 8.5Z" fill="#00897B" />
					<path
						d="M3 6V18C3 18.5523 3.44772 19 4 19H14C14.5523 19 15 18.5523 15 18V14L11 14V6H3Z"
						fill="#1E88E5"
					/>
					<path d="M11 6V14H15V10L11 6Z" fill="#FBC02D" />
					<path d="M15 14L11 10V14H15Z" fill="#E53935" />
					<path d="M11 6L15 10V6H11Z" fill="#4CAF50" />
				</svg>
			</span>
			Programează Google Meet
		</button>
		<button
			type="button"
			class="ct-back inline-flex items-center gap-1.5 rounded-lg border border-[#e5e9f0] bg-white px-3 py-[7px] text-[12.5px] font-semibold text-[#475569] transition-colors hover:border-[#1877F2] hover:bg-[#f7faff] hover:text-[#1877F2]"
			onclick={onBack}
		>
			<ChevronLeftIcon class="h-3.5 w-3.5" />
			Back to Tasks
		</button>
	</div>
</div>
