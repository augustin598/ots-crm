<!-- src/lib/components/client-task/client-task-team-card.svelte -->
<script lang="ts">
	import ContactAvatar from '$lib/components/ui/contact-avatar.svelte';
	import UsersIcon from '@lucide/svelte/icons/users';
	import XIcon from '@lucide/svelte/icons/x';

	type Assignee = {
		userId: string;
		firstName?: string | null;
		lastName?: string | null;
		email?: string | null;
		displayName?: string | null;
		online?: boolean;
		phone?: string | null;
	};

	type Props = {
		assignees: Assignee[];
		readonly?: boolean;
		onRemove?: (userId: string) => void;
		onAddClick?: () => void;
	};

	let { assignees, readonly = false, onRemove, onAddClick }: Props = $props();

	function displayName(a: Assignee): string {
		if (a.displayName) return a.displayName;
		const full = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
		return full || a.email || a.userId;
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<UsersIcon class="h-3.5 w-3.5 text-[#475569]" />
			<h4 class="text-[13px] font-bold uppercase tracking-[.04em] text-[#0f172a]">
				Echipă ({assignees.length})
			</h4>
		</div>
		{#if !readonly && onAddClick}
			<button
				type="button"
				class="text-[11.5px] font-semibold text-[#1877F2] hover:underline"
				onclick={onAddClick}
			>
				+ Adaugă
			</button>
		{/if}
	</div>

	{#if assignees.length === 0}
		<div class="text-[12px] text-[#94a3b8]">Nimeni asignat încă.</div>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each assignees as a (a.userId)}
				<li class="group flex items-center gap-2.5">
					<div class="relative shrink-0">
						<ContactAvatar
							src={null}
							name={displayName(a)}
							phoneE164={a.phone ?? a.email ?? a.userId}
							size="sm"
						/>
						{#if a.online !== undefined}
							<span
								class={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${a.online ? 'bg-[#10b981]' : 'bg-[#cbd5e1]'}`}
							></span>
						{/if}
					</div>
					<span class="flex-1 truncate text-[13px] font-semibold text-[#0f172a]">
						{displayName(a)}
					</span>
					{#if !readonly && onRemove}
						<button
							type="button"
							class="opacity-0 transition-opacity group-hover:opacity-100 text-[#94a3b8] hover:text-[#ef4444]"
							onclick={() => onRemove(a.userId)}
							aria-label={`Scoate ${displayName(a)}`}
						>
							<XIcon class="h-3.5 w-3.5" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
