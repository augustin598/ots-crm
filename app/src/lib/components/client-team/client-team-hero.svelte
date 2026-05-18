<!-- src/lib/components/client-team/client-team-hero.svelte -->
<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import PlusIcon from '@lucide/svelte/icons/plus';

	type Props = {
		onAddClick: () => void;
	};
	let { onAddClick }: Props = $props();
</script>

<div
	class="cteam-hero mx-7 mt-4 flex items-center justify-between gap-4 rounded-[14px] p-5 text-white"
	style:background="linear-gradient(135deg, #1877F2 0%, #0d5cc7 100%)"
>
	<div class="flex items-center gap-4">
		<div class="grid h-12 w-12 place-items-center rounded-[10px] bg-white/15 backdrop-blur-sm">
			<UsersIcon class="h-6 w-6 text-white" />
		</div>
		<div>
			<h2 class="text-[18px] font-bold leading-tight">Invită echipa</h2>
			<p class="mt-0.5 text-[12.5px] text-white/85">
				Adaugă colegi pentru a partaja taskuri, materiale și rapoarte
			</p>
		</div>
	</div>
	<button
		type="button"
		class="inline-flex items-center gap-1.5 rounded-[9px] bg-white px-4 py-2 text-[12.5px] font-semibold text-[#1877F2] hover:bg-white/90"
		onclick={onAddClick}
	>
		<PlusIcon class="h-3.5 w-3.5" />
		Adaugă acum
	</button>
</div>
