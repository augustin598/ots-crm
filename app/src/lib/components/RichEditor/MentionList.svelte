<script lang="ts">
	import { cn } from '$lib/utils';

	export type MentionUser = {
		id: string;
		firstName: string;
		lastName: string;
		email: string;
	};

	interface Props {
		items: MentionUser[];
		command: (item: { id: string; label: string }) => void;
	}

	let { items, command }: Props = $props();
	let selectedIndex = $state(0);

	$effect(() => {
		// Reset selection when items change
		items;
		selectedIndex = 0;
	});

	function getInitials(user: MentionUser): string {
		const first = user.firstName?.[0] || '';
		const last = user.lastName?.[0] || '';
		return (first + last).toUpperCase() || user.email[0]?.toUpperCase() || '?';
	}

	function getDisplayName(user: MentionUser): string {
		return `${user.firstName} ${user.lastName}`.trim() || user.email;
	}

	function selectItem(index: number) {
		const item = items[index];
		if (item) {
			command({ id: item.id, label: getDisplayName(item) });
		}
	}

	export function onKeyDown(event: KeyboardEvent): boolean {
		if (event.key === 'ArrowUp') {
			selectedIndex = (selectedIndex - 1 + items.length) % items.length;
			return true;
		}
		if (event.key === 'ArrowDown') {
			selectedIndex = (selectedIndex + 1) % items.length;
			return true;
		}
		if (event.key === 'Enter') {
			selectItem(selectedIndex);
			return true;
		}
		return false;
	}
</script>

{#if items.length > 0}
	<div class="z-50 w-64 rounded-lg border bg-popover shadow-lg overflow-hidden">
		<div class="max-h-[220px] overflow-y-auto py-1">
			{#each items as user, i}
				<button
					type="button"
					class={cn(
						'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
						i === selectedIndex && 'bg-accent'
					)}
					onclick={() => selectItem(i)}
				>
					<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
						{getInitials(user)}
					</div>
					<div class="min-w-0 flex-1">
						<p class="font-medium text-sm truncate">{getDisplayName(user)}</p>
						<p class="text-xs text-muted-foreground truncate">{user.email}</p>
					</div>
				</button>
			{/each}
		</div>
	</div>
{:else}
	<div class="z-50 w-64 rounded-lg border bg-popover shadow-lg p-3">
		<p class="text-sm text-muted-foreground text-center">No users found</p>
	</div>
{/if}
