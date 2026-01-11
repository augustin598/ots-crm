<script lang="ts">
	import { getTaskSettings, updateTaskSettings } from '$lib/remotes/task-settings.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import { CheckSquare } from '@lucide/svelte';

	const settingsQuery = getTaskSettings();
	const settings = $derived(settingsQuery.current);
	const loading = $derived(settingsQuery.loading);
	const error = $derived(settingsQuery.error);

	let taskRemindersEnabled = $state(settings?.taskRemindersEnabled ?? true);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);

	// Update local state when settings load
	$effect(() => {
		if (settings) {
			taskRemindersEnabled = settings.taskRemindersEnabled ?? true;
		}
	});

	async function handleSubmit() {
		saving = true;
		saveError = null;
		saveSuccess = false;

		try {
			await updateTaskSettings({
				taskRemindersEnabled
			}).updates(settingsQuery);
			saveSuccess = true;
			setTimeout(() => {
				saveSuccess = false;
			}, 3000);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to update task settings';
		} finally {
			saving = false;
		}
	}
</script>

<p class="text-muted-foreground mb-6">
	Configure task settings including email notifications and reminders.
</p>

<Card>
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			<CheckSquare class="h-5 w-5" />
			Task Settings
		</CardTitle>
		<CardDescription>Configure task-related settings and notifications</CardDescription>
	</CardHeader>
	<CardContent>
		{#if loading}
			<div class="space-y-4">
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
					<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
				</div>
			</div>
		{:else}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-6"
			>
				<div class="space-y-6">
					<h3 class="text-lg font-semibold">Email Notifications</h3>

					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="taskRemindersEnabled">Task Reminders</Label>
							<p class="text-xs text-muted-foreground">
								Send automatic email reminders for tasks due in the next 24 hours
							</p>
						</div>
						<Switch id="taskRemindersEnabled" bind:checked={taskRemindersEnabled} />
					</div>
				</div>

				{#if saveError}
					<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
						<p class="text-sm text-red-800 dark:text-red-200">{saveError}</p>
					</div>
				{/if}

				{#if saveSuccess}
					<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
						<p class="text-sm text-green-800 dark:text-green-200">Settings saved successfully!</p>
					</div>
				{/if}

				<div class="flex gap-2">
					<Button type="submit" disabled={saving}>
						{saving ? 'Saving...' : 'Save Settings'}
					</Button>
				</div>
			</form>
		{/if}
	</CardContent>
</Card>
