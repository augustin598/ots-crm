<script lang="ts">
	import { clientSignup } from '$lib/remotes/client-auth.remote';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import MailIcon from '@lucide/svelte/icons/mail';
	import BuildingIcon from '@lucide/svelte/icons/building';
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

<div class="flex min-h-screen">
	<!-- Left side - branding -->
	<div class="hidden lg:flex lg:w-1/2 items-center justify-center bg-primary/5 relative overflow-hidden">
		<div class="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5"></div>
		<div class="relative z-10 flex flex-col items-center gap-6 px-12 text-center">
			{#if invoiceLogo}
				<img
					src={invoiceLogo}
					alt={tenant?.name || 'Logo'}
					class="h-24 w-auto object-contain"
				/>
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

	<!-- Right side - signup form -->
	<div class="flex w-full lg:w-1/2 items-center justify-center px-6 py-12">
		<div class="w-full max-w-sm">
			<!-- Mobile logo -->
			<div class="mb-8 flex flex-col items-center lg:hidden">
				{#if invoiceLogo}
					<img
						src={invoiceLogo}
						alt={tenant?.name || 'Logo'}
						class="h-16 w-auto object-contain"
					/>
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
				<h1 class="text-2xl font-bold tracking-tight">Create your account</h1>
				<p class="text-sm text-muted-foreground">Enter your CUI and email to get started</p>
			</div>

			{#if success}
				<div class="rounded-lg border border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-950">
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
					class="space-y-4"
				>
					<div class="space-y-2">
						<Label for="cui">CUI (VAT Code)</Label>
						<div class="relative">
							<BuildingIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								id="cui"
								bind:value={cui}
								type="text"
								required
								placeholder="e.g. RO12345678"
								disabled={loading}
								class="pl-10"
							/>
						</div>
					</div>
					<div class="space-y-2">
						<Label for="email">Email</Label>
						<div class="relative">
							<MailIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								id="email"
								bind:value={email}
								type="email"
								required
								autocomplete="email"
								placeholder="name@company.com"
								disabled={loading}
								class="pl-10"
							/>
						</div>
					</div>
					{#if error}
						<div class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
							<p class="text-sm text-red-700 dark:text-red-300">{error}</p>
						</div>
					{/if}
					<Button type="submit" class="w-full" disabled={loading}>
						{loading ? 'Sending...' : 'Request Access'}
					</Button>
				</form>

				<div class="relative my-6">
					<div class="absolute inset-0 flex items-center">
						<span class="w-full border-t"></span>
					</div>
					<div class="relative flex justify-center text-xs uppercase">
						<span class="bg-background px-2 text-muted-foreground">or</span>
					</div>
				</div>

				<a
					href="/api/client-auth/google?tenant={tenantSlug}"
					class="inline-flex w-full items-center justify-center gap-3 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
				>
					<svg class="size-5" viewBox="0 0 24 24">
						<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
						<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
						<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
						<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
					</svg>
					Sign up with Google
				</a>
			{/if}

			<p class="mt-6 text-center text-sm text-muted-foreground">
				Already have an account?
				<a href="/client/{tenantSlug}/login" class="font-medium text-primary hover:underline">
					Request login link
				</a>
			</p>
		</div>
	</div>
</div>
