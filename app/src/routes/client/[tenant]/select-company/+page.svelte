<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import GateShell from '$lib/components/brand/GateShell.svelte';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const layoutData = $derived(page.data as Record<string, unknown>);
	const tenant = $derived(layoutData?.tenant as { name?: string } | null | undefined);
	const invoiceLogo = $derived(layoutData?.invoiceLogo as string | null | undefined);
	const user = $derived(
		layoutData?.user as { firstName?: string; email?: string } | null | undefined
	);
	const greetingName = $derived(
		user?.firstName?.trim() || user?.email?.split('@')[0] || ''
	);

	let submitting = $state<string | null>(null);

	function statusLabel(status: string | null): string {
		if (status === 'active') return 'Activ';
		if (status === 'inactive') return 'Inactiv';
		if (status === 'prospect') return 'Prospect';
		return status ?? '';
	}

	function statusColor(status: string | null): string {
		if (status === 'active') return 'text-emerald-600 dark:text-emerald-400';
		if (status === 'inactive') return 'text-muted-foreground';
		return 'text-amber-600 dark:text-amber-400';
	}
</script>

<svelte:head>
	<title>{tenant?.name ? `${tenant.name} - Selectați compania` : 'Selectați compania'}</title>
</svelte:head>

<GateShell logo={invoiceLogo || '/onetop-logo.png'} logoAlt={tenant?.name || 'One Top Solution'}>
	<div class="ots-gate-card">
		{#if greetingName}
			<p class="text-sm font-medium text-primary">
				Salut, {greetingName}! <span aria-hidden="true">👋</span>
			</p>
		{/if}
		<h1 class="text-2xl font-bold tracking-tight mt-1">Selectați compania</h1>
		<p class="text-sm text-muted-foreground mt-2">
			Aveți acces la {data.companies.length} companii. Alegeți compania pentru această sesiune.
		</p>

		{#if form?.error}
			<div
				class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950"
			>
				<p class="text-sm text-red-700 dark:text-red-300">{form.error}</p>
			</div>
		{/if}

		<ul class="mt-6 grid grid-cols-1 gap-2">
			{#each data.companies as company (company.id)}
				<li>
					<form
						method="POST"
						action="?/select"
						use:enhance={() => {
							submitting = company.id;
							return async ({ update }) => {
								await update();
								submitting = null;
							};
						}}
					>
						<input type="hidden" name="clientId" value={company.id} />
						<button type="submit" disabled={submitting !== null} class="ots-tenant group">
							<span class="ots-tenant-badge">
								<Building2Icon class="size-5" />
							</span>
							<span class="min-w-0 flex-1">
								<span class="flex min-w-0 items-baseline gap-2">
									<span class="min-w-0 truncate font-medium">
										{company.businessName ?? company.name}
									</span>
									{#if company.status && company.status !== 'active'}
										<span class="shrink-0 text-xs {statusColor(company.status)}">
											({statusLabel(company.status)})
										</span>
									{/if}
								</span>
								<span class="block text-xs text-muted-foreground truncate">
									{#if company.cui}
										CUI {company.cui}
									{:else}
										Fără CUI
									{/if}
								</span>
							</span>
							<ChevronRightIcon
								class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
							/>
						</button>
					</form>
				</li>
			{/each}
		</ul>
	</div>

	{#snippet footer()}
		<p class="mt-6 text-center text-xs text-muted-foreground">
			Powered by
			<a href="https://onetopsolution.ro" class="font-medium text-primary hover:underline">
				One Top Solution
			</a>
		</p>
	{/snippet}
</GateShell>
