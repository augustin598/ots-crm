<script lang="ts">
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuLabel,
		DropdownMenuSeparator,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { invalidateAll } from '$app/navigation';

	type Company = {
		id: string;
		name: string;
		cui: string | null;
		status: string | null;
	};

	let {
		companies,
		activeClientId,
		tenantSlug
	}: {
		companies: Company[];
		activeClientId: string | null;
		tenantSlug: string;
	} = $props();

	const active = $derived(companies.find((c) => c.id === activeClientId) ?? companies[0] ?? null);

	let switching = $state<string | null>(null);

	async function selectCompany(clientId: string) {
		if (switching || clientId === activeClientId) return;
		switching = clientId;
		try {
			const formData = new FormData();
			formData.set('clientId', clientId);
			const res = await fetch(`/client/${tenantSlug}/select-company?/select`, {
				method: 'POST',
				body: formData
			});
			if (res.redirected) {
				// Form action redirected to /dashboard — reload data on the new client.
				await invalidateAll();
				// Navigate to the redirect target so the user lands on dashboard rather than
				// staying on the previous (now stale) page.
				window.location.assign(res.url);
				return;
			}
			// Non-redirect responses come from SvelteKit form-action wrapping; refresh anyway.
			await invalidateAll();
		} finally {
			switching = null;
		}
	}
</script>

{#if companies.length > 1 && active}
	<DropdownMenu>
		<DropdownMenuTrigger>
			{#snippet child({ props })}
				<Button variant="outline" class="gap-2 max-w-[260px]" {...props}>
					<Building2Icon class="size-4 shrink-0" />
					<span class="truncate">{active.name}</span>
					<ChevronsUpDownIcon class="size-4 shrink-0 opacity-60" />
				</Button>
			{/snippet}
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end" class="w-72">
			<DropdownMenuLabel>Companii ({companies.length})</DropdownMenuLabel>
			<DropdownMenuSeparator />
			{#each companies as company (company.id)}
				<DropdownMenuItem
					onSelect={() => selectCompany(company.id)}
					disabled={switching !== null}
					class="flex items-start gap-2"
				>
					<div class="size-4 shrink-0 mt-0.5">
						{#if company.id === active.id}
							<CheckIcon class="size-4" />
						{/if}
					</div>
					<div class="flex-1 min-w-0">
						<div class="truncate text-sm">{company.name}</div>
						{#if company.cui}
							<div class="truncate text-xs text-muted-foreground">CUI {company.cui}</div>
						{/if}
					</div>
				</DropdownMenuItem>
			{/each}
		</DropdownMenuContent>
	</DropdownMenu>
{/if}
