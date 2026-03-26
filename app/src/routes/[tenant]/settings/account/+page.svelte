<script lang="ts">
	import type { PageData } from './$types';
	import { changePassword } from '$lib/remotes/auth.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { UserCircle } from '@lucide/svelte';

	let { data }: { data: PageData } = $props();

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);

	async function handleSubmit() {
		error = null;
		success = false;

		if (newPassword !== confirmPassword) {
			error = 'Parola nouă și confirmarea nu coincid';
			return;
		}

		if (newPassword.length < 6) {
			error = 'Parola nouă trebuie să aibă cel puțin 6 caractere';
			return;
		}

		loading = true;

		try {
			await changePassword({
				currentPassword,
				newPassword
			});
			success = true;
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'A apărut o eroare la schimbarea parolei';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<UserCircle class="h-5 w-5" />
				Schimbare parolă
			</CardTitle>
			<CardDescription>
				Schimbă parola contului tău. Vei avea nevoie de parola curentă pentru a confirma schimbarea.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-4"
			>
				<div class="space-y-2">
					<Label for="currentPassword">Parola curentă</Label>
					<Input
						id="currentPassword"
						type="password"
						bind:value={currentPassword}
						placeholder="Introdu parola curentă"
						required
						autocomplete="current-password"
					/>
				</div>

				<div class="space-y-2">
					<Label for="newPassword">Parola nouă</Label>
					<Input
						id="newPassword"
						type="password"
						bind:value={newPassword}
						placeholder="Introdu parola nouă (min. 6 caractere)"
						required
						minlength={6}
						autocomplete="new-password"
					/>
				</div>

				<div class="space-y-2">
					<Label for="confirmPassword">Confirmă parola nouă</Label>
					<Input
						id="confirmPassword"
						type="password"
						bind:value={confirmPassword}
						placeholder="Introdu din nou parola nouă"
						required
						minlength={6}
						autocomplete="new-password"
					/>
				</div>

				{#if error}
					<div class="rounded-md bg-red-50 dark:bg-red-950/50 p-3">
						<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
					</div>
				{/if}

				{#if success}
					<div class="rounded-md bg-green-50 dark:bg-green-950/50 p-3">
						<p class="text-sm text-green-800 dark:text-green-200">Parola a fost schimbată cu succes!</p>
					</div>
				{/if}

				<Button type="submit" disabled={loading}>
					{loading ? 'Se salvează...' : 'Schimbă parola'}
				</Button>
			</form>
		</CardContent>
	</Card>
</div>
