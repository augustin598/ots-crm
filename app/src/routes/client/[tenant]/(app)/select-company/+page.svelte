<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { Card, CardContent } from '$lib/components/ui/card';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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
	<title>Selectați compania — Client Portal</title>
</svelte:head>

<div class="flex flex-col items-center justify-center min-h-[70vh] py-8">
	<div class="w-full max-w-md space-y-6">
		<div class="text-center space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight">Selectați compania</h1>
			<p class="text-sm text-muted-foreground">
				Aveți acces la {data.companies.length} companii. Alegeți compania pentru această sesiune.
			</p>
		</div>

		{#if form?.error}
			<div class="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
				{form.error}
			</div>
		{/if}

		<Card>
			<CardContent class="p-2">
				<ul class="divide-y divide-border">
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
									class="w-full flex items-center justify-between gap-3 rounded-md px-3 py-3 text-left transition hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
								>
									<div class="flex items-center gap-3 min-w-0 flex-1">
										<div class="shrink-0 size-10 rounded-md bg-muted flex items-center justify-center">
											<Building2Icon class="size-5 text-muted-foreground" />
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
									<ChevronRightIcon class="size-4 text-muted-foreground shrink-0" />
								</button>
							</form>
						</li>
					{/each}
				</ul>
			</CardContent>
		</Card>
	</div>
</div>
