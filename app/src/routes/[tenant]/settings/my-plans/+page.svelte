<script lang="ts">
	import { getUserWorkHours, updateUserWorkHours } from '$lib/remotes/my-plans.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Calendar, Clock } from '@lucide/svelte';

	const workHoursQuery = getUserWorkHours();
	const workHours = $derived(workHoursQuery.current);
	const loading = $derived(workHoursQuery.loading);
	const error = $derived(workHoursQuery.error);

	let workStartTime = $state('09:00');
	let workEndTime = $state('17:00');
	let workDays = $state<string[]>(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
	let remindersEnabled = $state(true);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);

	const dayOptions = [
		{ value: 'monday', label: 'Monday' },
		{ value: 'tuesday', label: 'Tuesday' },
		{ value: 'wednesday', label: 'Wednesday' },
		{ value: 'thursday', label: 'Thursday' },
		{ value: 'friday', label: 'Friday' },
		{ value: 'saturday', label: 'Saturday' },
		{ value: 'sunday', label: 'Sunday' }
	];

	// Update local state when work hours load
	$effect(() => {
		if (workHours) {
			workStartTime = workHours.workStartTime || '09:00';
			workEndTime = workHours.workEndTime || '17:00';
			workDays = workHours.workDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
			remindersEnabled = workHours.remindersEnabled ?? true;
		}
	});

	function toggleWorkDay(day: string) {
		if (workDays.includes(day)) {
			workDays = workDays.filter((d) => d !== day);
		} else {
			workDays = [...workDays, day];
		}
	}

	async function handleSubmit() {
		saving = true;
		saveError = null;
		saveSuccess = false;

		try {
			await updateUserWorkHours({
				workStartTime: workStartTime || undefined,
				workEndTime: workEndTime || undefined,
				workDays: workDays.length > 0 ? workDays : undefined,
				remindersEnabled
			}).updates(workHoursQuery);

			saveSuccess = true;
			setTimeout(() => {
				saveSuccess = false;
			}, 3000);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to update work hours settings';
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center gap-2">
		<Calendar class="h-8 w-8" />
		<h1 class="text-3xl font-bold">My Plans Settings</h1>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Work Hours</CardTitle>
			<CardDescription>
				Configure your work hours and days. You'll receive email reminders at your work start time with tasks scheduled for that day.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			{#if loading}
				<p class="text-muted-foreground">Loading settings...</p>
			{:else}
				<div class="grid gap-4">
					<div class="grid gap-2">
						<Label for="work-start-time">Work Start Time</Label>
						<div class="flex items-center gap-2">
							<Clock class="h-4 w-4 text-muted-foreground" />
							<Input
								id="work-start-time"
								type="time"
								bind:value={workStartTime}
								class="w-[150px]"
							/>
						</div>
						<p class="text-sm text-muted-foreground">
							You'll receive email reminders at this time each work day
						</p>
					</div>

					<div class="grid gap-2">
						<Label for="work-end-time">Work End Time</Label>
						<div class="flex items-center gap-2">
							<Clock class="h-4 w-4 text-muted-foreground" />
							<Input
								id="work-end-time"
								type="time"
								bind:value={workEndTime}
								class="w-[150px]"
							/>
						</div>
						<p class="text-sm text-muted-foreground">Your work day ends at this time</p>
					</div>

					<div class="grid gap-2">
						<Label>Work Days</Label>
						<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
							{#each dayOptions as dayOption}
								<div class="flex items-center space-x-2">
									<Checkbox
										id="work-day-{dayOption.value}"
										checked={workDays.includes(dayOption.value)}
										onCheckedChange={() => toggleWorkDay(dayOption.value)}
									/>
									<Label
										for="work-day-{dayOption.value}"
										class="text-sm font-normal cursor-pointer"
									>
										{dayOption.label}
									</Label>
								</div>
							{/each}
						</div>
						<p class="text-sm text-muted-foreground">
							Select the days you work. Reminders are only sent on work days.
						</p>
					</div>

					<div class="flex items-center justify-between rounded-lg border p-4">
						<div class="space-y-0.5">
							<Label for="reminders-enabled">Email Reminders</Label>
							<p class="text-sm text-muted-foreground">
								Receive daily email reminders with your tasks at your work start time
							</p>
						</div>
						<Switch id="reminders-enabled" bind:checked={remindersEnabled} />
					</div>
				</div>

				{#if saveError}
					<div class="rounded-md bg-destructive/10 p-3">
						<p class="text-sm text-destructive">{saveError}</p>
					</div>
				{/if}

				{#if saveSuccess}
					<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
						<p class="text-sm text-green-800 dark:text-green-200">Settings saved successfully!</p>
					</div>
				{/if}

				<div class="flex justify-end">
					<Button onclick={handleSubmit} disabled={saving}>
						{saving ? 'Saving...' : 'Save Settings'}
					</Button>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
