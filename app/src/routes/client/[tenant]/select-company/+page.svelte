<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const layoutData = $derived(page.data as Record<string, unknown>);
	const tenant = $derived(layoutData?.tenant as { name?: string } | null | undefined);
	const invoiceLogo = $derived(layoutData?.invoiceLogo as string | null | undefined);

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

<div class="flex min-h-screen">
	<!-- Left side - branding -->
	<div class="hidden lg:flex lg:w-1/2 items-center justify-center bg-primary/5 relative overflow-hidden">
		<div class="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5"></div>
		<div class="relative z-10 flex flex-col items-center gap-6 px-12 text-center">
			{#if invoiceLogo}
				<img src={invoiceLogo} alt={tenant?.name || 'Logo'} class="h-24 w-auto object-contain" />
			{:else}
				<div class="flex h-24 w-24 items-center justify-center rounded-2xl bg-primary/10">
					<span class="text-4xl font-bold text-primary">
						{tenant?.name?.[0] || 'C'}
					</span>
				</div>
			{/if}
			<p class="mt-2 text-muted-foreground text-lg">Digital Marketing & Growth Solutions</p>
		</div>
	</div>

	<!-- Right side - selection -->
	<div class="flex w-full lg:w-1/2 items-center justify-center px-6 py-12">
		<div class="w-full max-w-sm">
			<!-- Mobile logo -->
			<div class="mb-8 flex flex-col items-center lg:hidden">
				{#if invoiceLogo}
					<img src={invoiceLogo} alt={tenant?.name || 'Logo'} class="h-16 w-auto object-contain" />
				{:else}
					<div class="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
						<span class="text-2xl font-bold text-primary">
							{tenant?.name?.[0] || 'C'}
						</span>
					</div>
				{/if}
				<h2 class="mt-4 text-xl font-semibold text-foreground">{tenant?.name || 'Client Portal'}</h2>
			</div>

			<div class="space-y-2 mb-8">
				<h1 class="text-2xl font-bold tracking-tight">Selectați compania</h1>
				<p class="text-sm text-muted-foreground">
					Aveți acces la {data.companies.length} companii. Alegeți compania pentru această sesiune.
				</p>
			</div>

			{#if form?.error}
				<div class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950 mb-4">
					<p class="text-sm text-red-700 dark:text-red-300">{form.error}</p>
				</div>
			{/if}

			<ul class="space-y-2">
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
							<button
								type="submit"
								disabled={submitting !== null}
								class="group w-full flex items-center justify-between gap-3 rounded-lg border border-input bg-background px-4 py-3.5 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
							>
								<div class="flex items-center gap-3 min-w-0 flex-1">
									<div class="shrink-0 size-10 rounded-md bg-primary/10 flex items-center justify-center">
										<Building2Icon class="size-5 text-primary" />
									</div>
									<div class="min-w-0 flex-1">
										<div class="flex items-baseline gap-2">
											<span class="font-medium truncate">
												{company.businessName ?? company.name}
											</span>
											{#if company.status && company.status !== 'active'}
												<span class="text-xs {statusColor(company.status)}">
													({statusLabel(company.status)})
												</span>
											{/if}
										</div>
										<div class="text-xs text-muted-foreground truncate">
											{#if company.cui}
												CUI {company.cui}
											{:else}
												Fără CUI
											{/if}
										</div>
									</div>
								</div>
								<ChevronRightIcon
									class="size-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
								/>
							</button>
						</form>
					</li>
				{/each}
			</ul>

			<p class="mt-8 text-center text-xs text-muted-foreground">
				Powered by
				<a href="https://onetopsolution.ro" class="font-medium text-primary hover:underline">One Top Solution</a>
			</p>
		</div>
	</div>
</div>
