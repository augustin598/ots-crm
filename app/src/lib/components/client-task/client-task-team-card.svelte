<!-- src/lib/components/client-task/client-task-team-card.svelte -->
<script lang="ts">
	import ContactAvatar from '$lib/components/ui/contact-avatar.svelte';
	import UsersIcon from '@lucide/svelte/icons/users';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';

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
	<div class="ct-section-head mb-3 flex items-center gap-2">
		<span
			class="grid h-7 w-7 place-items-center rounded-[7px] bg-[#f1f5f9] text-[#475569]"
		>
			<UsersIcon class="h-3.5 w-3.5" />
		</span>
		<h3 class="text-[15px] font-bold text-[#0f172a]">
			Echipa asignată ({assignees.length})
		</h3>
	</div>

	{#if assignees.length === 0}
		<div class="text-[12px] text-[#94a3b8]">Nimeni asignat încă.</div>
	{:else}
		<ul class="ct-team-list flex flex-col gap-2.5">
			{#each assignees as a (a.userId)}
				<li
					class="ct-team-row group flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-[#f7faff]"
				>
					<div class="relative shrink-0">
						<ContactAvatar
							src={null}
							name={displayName(a)}
							phoneE164={a.phone ?? a.email ?? a.userId}
							size="md"
						/>
						{#if a.online !== undefined}
							<span
								class={[
									'absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-white',
									a.online ? 'bg-[#10b981]' : 'bg-[#cbd5e1]'
								].join(' ')}
								aria-hidden="true"
							></span>
						{/if}
					</div>
					<div class="ct-team-info min-w-0 flex-1">
						<div class="ct-team-name truncate text-[13px] font-semibold text-[#0f172a]">
							{displayName(a)}
						</div>
						{#if a.email}
							<div class="ct-team-role truncate text-[11px] text-[#94a3b8]">{a.email}</div>
						{/if}
					</div>
					{#if !readonly && onRemove}
						<button
							type="button"
							class="ct-team-remove grid h-[22px] w-[22px] place-items-center rounded-full bg-[#f1f5f9] text-[#94a3b8] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#fee2e2] hover:text-[#ef4444]"
							onclick={() => onRemove(a.userId)}
							aria-label={`Scoate ${displayName(a)}`}
						>
							<XIcon class="h-2.5 w-2.5" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if !readonly && onAddClick}
		<div class="ct-add-sub mt-2.5 border-t border-dashed border-[#e5e9f0] pt-2.5">
			<button
				type="button"
				class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#e5e9f0] bg-white px-2 py-2 text-[12.5px] font-semibold text-[#475569] transition-colors hover:border-[#1877F2] hover:bg-[#f7faff] hover:text-[#1877F2]"
				onclick={onAddClick}
			>
				<PlusIcon class="h-3.5 w-3.5" />
				Adaugă membru
			</button>
		</div>
	{/if}
</div>
