<script lang="ts">
	import { clientSignup } from '$lib/remotes/client-auth.remote';
	import { page } from '$app/state';
	import { Input } from '$lib/components/ui/input';
	import GateShell from '$lib/components/brand/GateShell.svelte';
	import MailIcon from '@lucide/svelte/icons/mail';
	import BuildingIcon from '@lucide/svelte/icons/building';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';

	const tenantSlug = $derived(page.params.tenant as string);
	const layoutData = $derived(page.data as any);
	const tenant = $derived(layoutData?.tenant);
	const invoiceLogo = $derived(layoutData?.invoiceLogo);

	let cui = $state('');
	let email = $state(page.url.searchParams.get('email') || '');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);

	async function handleSubmit() {
		if (!cui.trim() || !email.trim()) {
			error = 'Please fill in all fields';
			return;
		}

		loading = true;
		error = null;
		success = false;

		try {
			await clientSignup({
				tenantSlug,
				cui: cui.trim(),
				email: email.trim()
			});
			success = true;
			cui = '';
			email = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Signup failed. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{tenant?.name ? `${tenant.name} - Signup` : 'Client Signup'}</title>
</svelte:head>

<GateShell logo={invoiceLogo || '/onetop-logo.png'} logoAlt={tenant?.name || 'One Top Solution'}>
	<div class="ots-gate-card">
		<h1 class="text-2xl font-bold tracking-tight">Create your account</h1>
		<p class="text-sm text-muted-foreground mt-2">Enter your CUI and email to get started</p>

		{#if success}
			<div
				class="mt-6 rounded-lg border border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-950"
			>
				<div class="flex items-start gap-3">
					<CheckCircleIcon class="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" />
					<div>
						<p class="font-medium text-green-800 dark:text-green-200">Check your email</p>
						<p class="mt-1 text-sm text-green-700 dark:text-green-300">
							A magic link has been sent to your inbox. Click the link to log in.
						</p>
					</div>
				</div>
			</div>
		{:else}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="mt-6 grid gap-4"
			>
				<div class="relative">
					<BuildingIcon
						class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						id="cui"
						bind:value={cui}
						type="text"
						required
						placeholder="CUI (ex. RO12345678)"
						aria-label="CUI (VAT Code)"
						disabled={loading}
						class="h-11 pl-10"
					/>
				</div>
				<div class="relative">
					<MailIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						id="email"
						bind:value={email}
						type="email"
						required
						autocomplete="email"
						placeholder="name@company.com"
						aria-label="Email"
						disabled={loading}
						class="h-11 pl-10"
					/>
				</div>
				{#if error}
					<div
						class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950"
					>
						<p class="text-sm text-red-700 dark:text-red-300">{error}</p>
					</div>
				{/if}
				<button type="submit" class="ots-gate-btn ots-gloss" disabled={loading}>
					{loading ? 'Sending...' : 'Request Access'}
					<ArrowRightIcon class="h-4 w-4" />
				</button>
			</form>

			<div class="relative my-6">
				<div class="absolute inset-0 flex items-center">
					<span class="w-full border-t"></span>
				</div>
				<div class="relative flex justify-center text-xs uppercase">
					<span class="bg-card px-2 text-muted-foreground">or</span>
				</div>
			</div>

			<a href="/api/client-auth/google?tenant={tenantSlug}" class="ots-gate-btn ots-gate-btn-ghost">
				<svg class="size-5" viewBox="0 0 24 24">
					<path
						d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
						fill="#4285F4"
					/>
					<path
						d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
						fill="#34A853"
					/>
					<path
						d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
						fill="#FBBC05"
					/>
					<path
						d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
						fill="#EA4335"
					/>
				</svg>
				Sign up with Google
			</a>
		{/if}
	</div>

	{#snippet footer()}
		<p class="mt-6 text-center text-sm text-muted-foreground">
			Already have an account?
			<a href="/client/{tenantSlug}/login" class="font-medium text-primary hover:underline">
				Request login link
			</a>
		</p>
	{/snippet}
</GateShell>
