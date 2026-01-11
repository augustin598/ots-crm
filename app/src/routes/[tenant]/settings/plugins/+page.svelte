<script lang="ts">
	import { getPlugins, enablePlugin, disablePlugin } from '$lib/remotes/plugins.remote';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import { CheckCircle2, XCircle } from '@lucide/svelte';
	import { page } from '$app/state';

	const tenantSlug = $derived(page.params.tenant);

	const pluginsQuery = getPlugins();
	const plugins = $derived(pluginsQuery.current || []);
	const loading = $derived(pluginsQuery.loading);
	const error = $derived(pluginsQuery.error);

	let togglingPlugin = $state<string | null>(null);
	let pluginStates = $state<Record<string, boolean>>({});

	// Initialize plugin states
	$effect(() => {
		if (plugins) {
			for (const plugin of plugins) {
				if (!(plugin.id in pluginStates)) {
					pluginStates[plugin.id] = plugin.enabled;
				}
			}
		}
	});

	async function handleTogglePlugin(pluginId: string) {
		const currentState = pluginStates[pluginId] ?? false;
		const newState = !currentState;

		// Optimistically update UI
		pluginStates[pluginId] = newState;
		togglingPlugin = pluginId;

		try {
			if (newState) {
				await enablePlugin(pluginId).updates(pluginsQuery);
			} else {
				await disablePlugin(pluginId).updates(pluginsQuery);
			}
		} catch (e) {
			// Revert on error
			pluginStates[pluginId] = currentState;
			console.error('Failed to toggle plugin:', e);
			alert(e instanceof Error ? e.message : 'Failed to toggle plugin');
		} finally {
			togglingPlugin = null;
		}
	}
</script>

<div class="space-y-4">
	<p class="mb-6 text-muted-foreground">
		Manage integrations and plugins for your organization. Enable or disable plugins to extend
		functionality.
	</p>

	{#if error}
		<div class="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
			<p class="text-sm text-red-800 dark:text-red-200">
				{error instanceof Error ? error.message : 'Failed to load plugins'}
			</p>
		</div>
	{/if}

	{#if loading}
		<div class="space-y-4">
			{#each Array(2) as _}
				<Card>
					<CardContent class="p-6">
						<div class="animate-pulse space-y-4">
							<div class="h-4 w-1/4 rounded bg-gray-200 dark:bg-gray-700"></div>
							<div class="h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700"></div>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{:else if plugins.length === 0}
		<Card>
			<CardContent class="p-6">
				<p class="text-center text-muted-foreground">No plugins available.</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each plugins as plugin}
				{@const isEnabled = pluginStates[plugin.id] ?? plugin.enabled}

				<Card>
					<CardHeader>
						<div class="flex items-start justify-between">
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<CardTitle>{plugin.displayName}</CardTitle>
									{#if plugin.enabled}
										<Badge variant="default" class="gap-1">
											<CheckCircle2 class="h-3 w-3" />
											Enabled
										</Badge>
									{:else}
										<Badge variant="outline" class="gap-1">
											<XCircle class="h-3 w-3" />
											Disabled
										</Badge>
									{/if}
								</div>
								<CardDescription class="mt-2"
									>{plugin.description || 'No description available'}</CardDescription
								>
								<div class="mt-2 text-xs text-muted-foreground">
									Version: {plugin.version}
								</div>
							</div>
							<div class="flex items-center gap-4">
								<div class="flex items-center gap-2">
									<Switch
										checked={isEnabled}
										onclick={() => handleTogglePlugin(plugin.id)}
										disabled={togglingPlugin === plugin.id}
									/>
									<Label for={`plugin-${plugin.id}`} class="cursor-pointer">
										{isEnabled ? 'Enabled' : 'Disabled'}
									</Label>
								</div>
							</div>
						</div>
					</CardHeader>
					{#if plugin.name === 'smartbill'}
						<CardContent>
							<Separator class="mb-4" />
							<div class="space-y-2">
								<p class="text-sm font-medium">SmartBill Integration</p>
								<p class="text-sm text-muted-foreground">
									Connect your SmartBill account to sync invoices and retrieve bills automatically.
								</p>
								{#if isEnabled}
									<Button variant="outline" size="sm" href="/{tenantSlug}/settings/smartbill">
										Configure SmartBill
									</Button>
								{/if}
							</div>
						</CardContent>
					{/if}
					{#if plugin.name === 'banking-revolut'}
						<CardContent>
							<Separator class="mb-4" />
							<div class="space-y-2">
								<p class="text-sm font-medium">Revolut Banking Integration</p>
								<p class="text-sm text-muted-foreground">
									Configure your Revolut Business API certificate and credentials.
								</p>
								{#if isEnabled}
									<Button variant="outline" size="sm" href="/{tenantSlug}/settings/revolut">
										Configure Revolut
									</Button>
								{/if}
							</div>
						</CardContent>
					{/if}
				</Card>
			{/each}
		</div>
	{/if}
</div>
