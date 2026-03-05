<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
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
		entry,
		currentClientUserId = null,
		isClientUser = false,
		onEdit,
		onDelete
	}: {
		entry: AccessEntry;
		currentClientUserId?: string | null;
		isClientUser?: boolean;
		onEdit?: (entry: AccessEntry) => void;
		onDelete?: (entry: AccessEntry) => void;
	} = $props();

	let showPassword = $state(false);

	const canModify = $derived(
		!isClientUser || entry.createdByClientUserId === currentClientUserId
	);

	const parsedCustomFields = $derived(() => {
		if (!entry.customFields) return [];
		try { return JSON.parse(entry.customFields) as { key: string; value: string }[]; }
		catch { return []; }
	});

	async function copyToClipboard(text: string, label: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${label} copiat`);
		} catch {
			toast.error('Nu s-a putut copia');
		}
	}
</script>

<Card.Root class="group relative">
	<Card.Header class="pb-3">
		<div class="flex items-start justify-between">
			<Card.Title class="text-base font-semibold leading-tight">{entry.label}</Card.Title>
			{#if canModify}
				<div class="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
					<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => onEdit?.(entry)}>
						<PencilIcon class="h-3.5 w-3.5" />
					</Button>
					<Button variant="ghost" size="icon" class="h-7 w-7 text-destructive" onclick={() => onDelete?.(entry)}>
						<Trash2Icon class="h-3.5 w-3.5" />
					</Button>
				</div>
			{/if}
		</div>
	</Card.Header>
	<Card.Content class="space-y-2 text-sm">
		{#if entry.url}
			<div class="flex items-center gap-2">
				<span class="text-muted-foreground w-16 shrink-0">URL</span>
				<a href={entry.url} target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 truncate text-primary hover:underline">
					{entry.url}
					<ExternalLinkIcon class="h-3 w-3 shrink-0" />
				</a>
			</div>
		{/if}

		{#if entry.username}
			<div class="flex items-center gap-2">
				<span class="text-muted-foreground w-16 shrink-0">User</span>
				<code class="truncate text-xs bg-muted px-1.5 py-0.5 rounded">{entry.username}</code>
				<Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" onclick={() => copyToClipboard(entry.username!, 'Username')}>
					<CopyIcon class="h-3 w-3" />
				</Button>
			</div>
		{/if}

		{#if entry.password}
			<div class="flex items-center gap-2">
				<span class="text-muted-foreground w-16 shrink-0">Parolă</span>
				<code class="truncate text-xs bg-muted px-1.5 py-0.5 rounded">
					{showPassword ? entry.password : '••••••••'}
				</code>
				<Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" onclick={() => (showPassword = !showPassword)}>
					{#if showPassword}
						<EyeOffIcon class="h-3 w-3" />
					{:else}
						<EyeIcon class="h-3 w-3" />
					{/if}
				</Button>
				<Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" onclick={() => copyToClipboard(entry.password!, 'Parola')}>
					<CopyIcon class="h-3 w-3" />
				</Button>
			</div>
		{/if}

		{#if entry.notes}
			<div class="flex gap-2">
				<span class="text-muted-foreground w-16 shrink-0">Note</span>
				<p class="text-muted-foreground line-clamp-2">{entry.notes}</p>
			</div>
		{/if}

		{#if parsedCustomFields().length > 0}
			<div class="border-t pt-2 mt-2 space-y-1">
				{#each parsedCustomFields() as field}
					<div class="flex items-center gap-2">
						<span class="text-muted-foreground w-16 shrink-0 truncate text-xs">{field.key}</span>
						<code class="truncate text-xs bg-muted px-1.5 py-0.5 rounded">{field.value}</code>
						<Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" onclick={() => copyToClipboard(field.value, field.key)}>
							<CopyIcon class="h-3 w-3" />
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
