<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { groupVariablesByCategory } from '$lib/utils/document-variables';
	import type { VariableMap } from '$lib/utils/document-variables';

	interface Props {
		standardVariables: VariableMap;
		customVariables: Array<{ key: string; label: string; defaultValue?: string }>;
		customValues: Record<string, string>;
		onCustomValueChange: (key: string, value: string) => void;
	}

	let { standardVariables, customVariables, customValues = $bindable({}), onCustomValueChange }: Props =
		$props();

	const grouped = $derived.by(() => {
		if (!standardVariables || Object.keys(standardVariables).length === 0) {
			return {
				tenant: [],
				client: [],
				project: [],
				system: [],
				custom: []
			};
		}
		return groupVariablesByCategory(standardVariables);
	});
</script>

<div class="space-y-4">
	<!-- Standard Variables (Read-only) -->
	<Card>
		<CardHeader>
			<CardTitle class="text-sm">Standard Variables</CardTitle>
			<CardDescription class="text-xs">
				These are automatically filled from client and tenant data
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3">
			{#if grouped.tenant.length > 0}
				<div>
					<p class="text-xs font-semibold text-muted-foreground mb-2">Tenant</p>
					<div class="space-y-1">
						{#each grouped.tenant as variable}
							<div class="flex items-center justify-between text-sm py-1">
								<span class="text-muted-foreground">{variable.key}</span>
								<span class="font-medium">{variable.value || '-'}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if grouped.client.length > 0}
				<div>
					<p class="text-xs font-semibold text-muted-foreground mb-2">Client</p>
					<div class="space-y-1">
						{#each grouped.client as variable}
							<div class="flex items-center justify-between text-sm py-1">
								<span class="text-muted-foreground">{variable.key}</span>
								<span class="font-medium">{variable.value || '-'}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if grouped.project.length > 0}
				<div>
					<p class="text-xs font-semibold text-muted-foreground mb-2">Project</p>
					<div class="space-y-1">
						{#each grouped.project as variable}
							<div class="flex items-center justify-between text-sm py-1">
								<span class="text-muted-foreground">{variable.key}</span>
								<span class="font-medium">{variable.value || '-'}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if grouped.system.length > 0}
				<div>
					<p class="text-xs font-semibold text-muted-foreground mb-2">System</p>
					<div class="space-y-1">
						{#each grouped.system as variable}
							<div class="flex items-center justify-between text-sm py-1">
								<span class="text-muted-foreground">{variable.key}</span>
								<span class="font-medium">{variable.value || '-'}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Custom Variables (Editable) -->
	{#if customVariables.length > 0}
		<Card>
			<CardHeader>
				<CardTitle class="text-sm">Custom Variables</CardTitle>
				<CardDescription class="text-xs">Fill in these values</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3">
				{#each customVariables as variable}
					<div class="space-y-1">
						<Label for="var-{variable.key}" class="text-sm">
							{variable.label}
							{#if variable.key}
								<span class="text-muted-foreground text-xs">({`{{${variable.key}}}`})</span>
							{/if}
						</Label>
						{#if variable.key.includes('description') || variable.key.includes('notes')}
							<Textarea
								id="var-{variable.key}"
								value={customValues[variable.key] || variable.defaultValue || ''}
								placeholder="Enter {variable.label.toLowerCase()}"
								rows="3"
								oninput={(e) => {
									const value = (e.target as HTMLTextAreaElement).value;
									customValues = { ...customValues, [variable.key]: value };
									onCustomValueChange(variable.key, value);
								}}
							/>
						{:else}
							<Input
								id="var-{variable.key}"
								type="text"
								value={customValues[variable.key] || variable.defaultValue || ''}
								placeholder="Enter {variable.label.toLowerCase()}"
								oninput={(e) => {
									const value = (e.target as HTMLInputElement).value;
									customValues = { ...customValues, [variable.key]: value };
									onCustomValueChange(variable.key, value);
								}}
							/>
						{/if}
					</div>
				{/each}
			</CardContent>
		</Card>
	{/if}
</div>
