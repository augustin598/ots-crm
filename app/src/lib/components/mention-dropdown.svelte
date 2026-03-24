<script lang="ts">
	import { cn } from '$lib/utils';

	export type MentionUser = {
		id: string;
		firstName: string;
		lastName: string;
		email: string;
	};

	interface Props {
		users: MentionUser[];
		visible: boolean;
		query: string;
		position: { top: number; left: number };
		selectedIndex: number;
		onSelect: (user: MentionUser) => void;
	}

	let { users, visible, query, position, selectedIndex, onSelect }: Props = $props();

	function getInitials(user: MentionUser): string {
		const first = user.firstName?.[0] || '';
		const last = user.lastName?.[0] || '';
		return (first + last).toUpperCase() || user.email[0]?.toUpperCase() || '?';
	}

	function getDisplayName(user: MentionUser): string {
		return `${user.firstName} ${user.lastName}`.trim() || user.email;
	}

	const filtered = $derived.by(() => {
		if (!query) return users.slice(0, 5);
		const q = query.toLowerCase();
		return users
			.filter((u) => {
				const name = `${u.firstName} ${u.lastName}`.toLowerCase();
				return name.includes(q) || u.email.toLowerCase().includes(q);
			})
			.slice(0, 5);
	});
</script>

{#if visible && filtered.length > 0}
	<div
		class="absolute z-50 w-64 rounded-lg border bg-popover shadow-lg overflow-hidden"
		style="top: {position.top}px; left: {position.left}px;"
	>
		<div class="max-h-[220px] overflow-y-auto py-1">
			{#each filtered as user, i}
				<button
					type="button"
					class={cn(
						'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
						i === selectedIndex && 'bg-accent'
					)}
					onmousedown={(e) => { e.preventDefault(); onSelect(user); }}
				>
					<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
						{getInitials(user)}
					</div>
					<div class="min-w-0 flex-1">
						<p class="font-medium truncate">{getDisplayName(user)}</p>
						<p class="text-xs text-muted-foreground truncate">{user.email}</p>
					</div>
				</button>
			{/each}
		</div>
	</div>
{/if}
