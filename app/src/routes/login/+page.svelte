<script lang="ts">
	import '../layout.css';
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Admin Login - DAVFOR GROUP</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-md">
		<CardHeader class="space-y-1">
			<CardTitle class="text-2xl font-bold">Admin Login</CardTitle>
			<CardDescription>Enter your credentials to access the admin panel</CardDescription>
		</CardHeader>
		<CardContent>
			<form method="post" action="?/login" use:enhance class="space-y-4">
				<div class="space-y-2">
					<Label for="username">Username</Label>
					<Input
						id="username"
						name="username"
						type="text"
						required
						autocomplete="username"
						placeholder="Enter your username"
					/>
				</div>
				<div class="space-y-2">
					<Label for="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						required
						autocomplete="current-password"
						placeholder="Enter your password"
					/>
				</div>
				{#if form?.message}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{form.message}</p>
					</div>
				{/if}
				<Button type="submit" class="w-full">Login</Button>
			</form>
		</CardContent>
	</Card>
</div>

