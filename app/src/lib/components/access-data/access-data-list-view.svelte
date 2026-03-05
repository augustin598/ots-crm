<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { toast } from 'svelte-sonner';

	interface AccessEntry {
		id: string;
		category: string;
		label: string;
		url: string | null;
		username: string | null;
		password: string | null;
		notes: string | null;
		customFields: string | null;
		createdByClientUserId: string | null;
	}

	let {
		entries,
		currentClientUserId = null,
		isClientUser = false,
		onEdit,
		onDelete
	}: {
		entries: AccessEntry[];
		currentClientUserId?: string | null;
		isClientUser?: boolean;
		onEdit?: (entry: AccessEntry) => void;
		onDelete?: (entry: AccessEntry) => void;
	} = $props();

	let visiblePasswords = $state<Record<string, boolean>>({});

	function canModify(entry: AccessEntry) {
		return !isClientUser || entry.createdByClientUserId === currentClientUserId;
	}

	async function copyToClipboard(text: string, label: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${label} copiat`);
		} catch {
			toast.error('Nu s-a putut copia');
		}
	}
</script>

<div class="rounded-md border">
	<table class="w-full text-sm">
		<thead>
			<tr class="border-b bg-muted/50">
				<th class="text-left font-medium px-4 py-2.5">Label</th>
				<th class="text-left font-medium px-4 py-2.5">URL</th>
				<th class="text-left font-medium px-4 py-2.5">Username</th>
				<th class="text-left font-medium px-4 py-2.5">Parolă</th>
				<th class="text-left font-medium px-4 py-2.5">Note</th>
				<th class="text-right font-medium px-4 py-2.5 w-24">Acțiuni</th>
			</tr>
		</thead>
		<tbody>
			{#each entries as entry (entry.id)}
				<tr class="border-b last:border-0 hover:bg-muted/30 group">
					<td class="px-4 py-2.5 font-medium">{entry.label}</td>
					<td class="px-4 py-2.5 max-w-[200px]">
						{#if entry.url}
							<a href={entry.url} target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 truncate text-primary hover:underline text-xs">
								{entry.url}
								<ExternalLinkIcon class="h-3 w-3 shrink-0" />
							</a>
						{:else}
							<span class="text-muted-foreground">—</span>
						{/if}
					</td>
					<td class="px-4 py-2.5">
						{#if entry.username}
							<div class="flex items-center gap-1">
								<code class="text-xs bg-muted px-1.5 py-0.5 rounded truncate max-w-[150px]">{entry.username}</code>
								<Button variant="ghost" size="icon" class="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100" onclick={() => copyToClipboard(entry.username!, 'Username')}>
									<CopyIcon class="h-3 w-3" />
								</Button>
							</div>
						{:else}
							<span class="text-muted-foreground">—</span>
						{/if}
					</td>
					<td class="px-4 py-2.5">
						{#if entry.password}
							<div class="flex items-center gap-1">
								<code class="text-xs bg-muted px-1.5 py-0.5 rounded">
									{visiblePasswords[entry.id] ? entry.password : '••••••••'}
								</code>
								<Button variant="ghost" size="icon" class="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100" onclick={() => (visiblePasswords[entry.id] = !visiblePasswords[entry.id])}>
									{#if visiblePasswords[entry.id]}
										<EyeOffIcon class="h-3 w-3" />
									{:else}
										<EyeIcon class="h-3 w-3" />
									{/if}
								</Button>
								<Button variant="ghost" size="icon" class="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100" onclick={() => copyToClipboard(entry.password!, 'Parola')}>
									<CopyIcon class="h-3 w-3" />
								</Button>
							</div>
						{:else}
							<span class="text-muted-foreground">—</span>
						{/if}
					</td>
					<td class="px-4 py-2.5 max-w-[200px]">
						{#if entry.notes}
							<p class="text-muted-foreground text-xs truncate">{entry.notes}</p>
						{:else}
							<span class="text-muted-foreground">—</span>
						{/if}
					</td>
					<td class="px-4 py-2.5 text-right">
						{#if canModify(entry)}
							<div class="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
								<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => onEdit?.(entry)}>
									<PencilIcon class="h-3.5 w-3.5" />
								</Button>
								<Button variant="ghost" size="icon" class="h-7 w-7 text-destructive" onclick={() => onDelete?.(entry)}>
									<Trash2Icon class="h-3.5 w-3.5" />
								</Button>
							</div>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
