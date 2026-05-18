<!-- src/lib/components/client-team/client-team-page-header.svelte -->
<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	type Props = {
		clientName: string;
		stats: {
			total: number;
			online: number;
			pending: number;
			openTasks: number;
		};
		search: string;
		onSearchChange: (v: string) => void;
		onPermissionsClick: () => void;
		onInviteClick: () => void;
	};

	let { clientName, stats, search, onSearchChange, onPermissionsClick, onInviteClick }: Props = $props();
</script>

<header class="cteam-header flex flex-col gap-4 px-7 pt-6">
	<nav class="cteam-crumb flex items-center gap-1.5 text-[12.5px] text-[#64748b]">
		<SettingsIcon class="h-3.5 w-3.5" />
		<span>Setări companie</span>
		<ChevronRightIcon class="h-3 w-3 text-[#cbd5e1]" />
		<span class="font-semibold text-[#0f172a]">Echipa mea</span>
	</nav>

	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="cteam-title text-[26px] font-extrabold tracking-tight text-[#0f172a]">
				Echipa {clientName}
			</h1>
			<p class="cteam-sub mt-1 text-[13px] text-[#64748b]">
				{stats.total} membri ·
				<span class="font-semibold text-[#10b981]">{stats.online} online</span>
				· {stats.pending} aprobări în așteptare · {stats.openTasks} taskuri active
			</p>
		</div>

		<div class="cteam-actions flex items-center gap-2">
			<div class="cteam-search relative">
				<SearchIcon class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]" />
				<input
					type="text"
					placeholder="Caută coleg..."
					value={search}
					oninput={(e) => onSearchChange((e.currentTarget as HTMLInputElement).value)}
					class="min-w-[260px] rounded-[9px] border border-[#e5e9f0] bg-white py-[7px] pl-9 pr-3 text-[12.5px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
				/>
			</div>
			<button
				type="button"
				class="cteam-btn ghost inline-flex items-center gap-1.5 rounded-[9px] border border-[#d5dbe5] bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[#475569] hover:border-[#1877F2] hover:text-[#0f172a]"
				onclick={onPermissionsClick}
			>
				<ShieldIcon class="h-3.5 w-3.5" />
				Permisiuni
			</button>
			<button
				type="button"
				class="cteam-btn primary inline-flex items-center gap-1.5 rounded-[9px] bg-[#1877F2] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[#0d5cc7]"
				onclick={onInviteClick}
			>
				<PlusIcon class="h-3.5 w-3.5" />
				Invită coleg
			</button>
		</div>
	</div>
</header>
