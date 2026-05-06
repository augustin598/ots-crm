<script lang="ts">
	import type { PageData } from './$types';
	import { registerWithTenant } from '$lib/remotes/register.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { getAdminRole, getDepartment } from '$lib/config/team';
	import MailIcon from '@lucide/svelte/icons/mail';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import LockIcon from '@lucide/svelte/icons/lock';
	import CheckIcon from '@lucide/svelte/icons/check';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	let { data }: { data: PageData } = $props();

	const token = $derived(page.params.token || '');
	const inv = $derived(data.invitation);
	const tenant = $derived(inv?.tenant ?? null);
	const inviter = $derived(inv?.invitedBy ?? null);
	const inviterName = $derived(
		inviter
			? `${inviter.firstName ?? ''} ${inviter.lastName ?? ''}`.trim() || inviter.email
			: 'Echipa'
	);
	const roleMeta = $derived(inv ? getAdminRole(inv.role) : null);
	const deptMeta = $derived(inv?.department ? getDepartment(inv.department) : null);

	let firstName = $state('');
	let lastName = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	async function handleSubmit() {
		if (!token) {
			error = 'Token de invitație invalid.';
			return;
		}
		if (!inv) return;
		if (password !== passwordConfirm) {
			error = 'Parolele nu coincid.';
			return;
		}
		if (password.length < 8) {
			error = 'Parola trebuie să aibă cel puțin 8 caractere.';
			return;
		}

		loading = true;
		error = null;

		try {
			const result = await registerWithTenant({
				email: inv.email,
				firstName,
				lastName,
				password,
				passwordConfirm,
				invitationToken: token
			});

			if (result.success && result.tenantSlug) {
				goto(`/${result.tenantSlug}`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Crearea contului a eșuat.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{tenant?.name ? `${tenant.name} — Creează cont` : 'Creează cont'}</title>
</svelte:head>

<div class="flex min-h-screen">
	<!-- Left: branding -->
	<div
		class="hidden lg:flex lg:w-1/2 items-center justify-center bg-primary/5 relative overflow-hidden"
	>
		<div class="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5"></div>
		<div class="relative z-10 flex flex-col items-center gap-6 px-12 text-center">
			<div class="flex h-24 w-24 items-center justify-center rounded-2xl bg-primary/10">
				<span class="text-4xl font-bold text-primary">
					{tenant?.name?.[0] ?? 'O'}
				</span>
			</div>
			<div>
				<h2 class="text-2xl font-bold text-foreground">{tenant?.name ?? 'OTS CRM'}</h2>
				<p class="mt-2 text-muted-foreground text-lg">Digital Marketing & Growth Solutions</p>
			</div>
			<div class="mt-4 flex items-center gap-2 rounded-full bg-card px-4 py-2 border border-border shadow-sm">
				<UserPlusIcon class="size-4 text-primary" />
				<span class="text-sm font-medium">Creează cont și acceptă invitația</span>
			</div>
		</div>
	</div>

	<!-- Right: signup form -->
	<div class="flex w-full lg:w-1/2 items-center justify-center px-6 py-12">
		<div class="w-full max-w-sm">
			<!-- Mobile branding -->
			<div class="mb-8 flex flex-col items-center lg:hidden">
				<div class="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
					<span class="text-2xl font-bold text-primary">
						{tenant?.name?.[0] ?? 'O'}
					</span>
				</div>
				<h2 class="mt-4 text-xl font-semibold text-foreground">
					{tenant?.name ?? 'OTS CRM'}
				</h2>
			</div>

			{#if data.error}
				<div class="space-y-4">
					<div class="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-950">
						<AlertTriangleIcon class="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
						<div>
							<p class="font-medium text-red-800 dark:text-red-200">Invitație invalidă</p>
							<p class="mt-1 text-sm text-red-700 dark:text-red-300">{data.error}</p>
						</div>
					</div>
					<Button onclick={() => goto('/')} class="w-full">Înapoi la pagina principală</Button>
				</div>
			{:else if inv && data.emailExists}
				<div class="space-y-4">
					<div class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950">
						<AlertTriangleIcon class="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
						<div>
							<p class="font-medium text-amber-900 dark:text-amber-100">Cont existent</p>
							<p class="mt-1 text-sm text-amber-800 dark:text-amber-200">
								Adresa <strong>{inv.email}</strong> are deja un cont. Conectează-te pentru a accepta invitația — nu este nevoie să creezi unul nou.
							</p>
						</div>
					</div>
					<Button
						onclick={() =>
							goto('/login?redirect=' + encodeURIComponent('/invite/' + token))}
						class="w-full"
						size="lg"
					>
						<UserPlusIcon class="mr-2 size-4" />
						Login pentru a accepta
					</Button>
				</div>
			{:else if inv}
				<div class="space-y-2 mb-6">
					<h1 class="text-2xl font-bold tracking-tight">Creează cont</h1>
					<p class="text-sm text-muted-foreground">
						{#if tenant}Te alături organizației <strong class="text-foreground">{tenant.name}</strong>.{/if}
					</p>
				</div>

				<!-- Invitation summary card -->
				<div class="rounded-xl border border-border bg-card p-4 mb-6 space-y-2">
					<div class="text-xs text-muted-foreground">
						Invitat de <strong class="text-foreground">{inviterName}</strong>
					</div>
					<div class="flex flex-wrap gap-2">
						{#if roleMeta}
							<span
								class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
								style="background:{roleMeta.bg}; color:{roleMeta.color}"
							>
								<span class="size-1.5 rounded-full" style="background:{roleMeta.color}"></span>
								{roleMeta.label}
							</span>
						{/if}
						{#if deptMeta}
							<span
								class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
								style="background:color-mix(in srgb, {deptMeta.color} 14%, transparent); color:{deptMeta.color}"
							>
								<span class="size-1.5 rounded-full" style="background:{deptMeta.color}"></span>
								{deptMeta.label}
							</span>
						{/if}
						{#if inv.title}
							<span
								class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border border-border bg-background text-muted-foreground"
							>
								{inv.title}
							</span>
						{/if}
					</div>
				</div>

				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					class="space-y-4"
				>
					<div class="space-y-2">
						<Label for="email">Email</Label>
						<div class="relative">
							<MailIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input id="email" type="email" value={inv.email} disabled class="pl-10 bg-muted/40" />
						</div>
						<p class="text-xs text-muted-foreground">
							Email-ul folosit pentru invitație — nu poate fi modificat.
						</p>
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-2">
							<Label for="firstName">Prenume</Label>
							<Input
								id="firstName"
								bind:value={firstName}
								type="text"
								required
								autocomplete="given-name"
								placeholder="ex: Ion"
								disabled={loading}
							/>
						</div>
						<div class="space-y-2">
							<Label for="lastName">Nume</Label>
							<Input
								id="lastName"
								bind:value={lastName}
								type="text"
								required
								autocomplete="family-name"
								placeholder="ex: Popescu"
								disabled={loading}
							/>
						</div>
					</div>

					<div class="space-y-2">
						<Label for="password">Parolă</Label>
						<div class="relative">
							<LockIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								id="password"
								bind:value={password}
								type="password"
								required
								autocomplete="new-password"
								placeholder="minim 8 caractere"
								disabled={loading}
								class="pl-10"
							/>
						</div>
					</div>

					<div class="space-y-2">
						<Label for="passwordConfirm">Confirmă parola</Label>
						<div class="relative">
							<LockIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								id="passwordConfirm"
								bind:value={passwordConfirm}
								type="password"
								required
								autocomplete="new-password"
								placeholder="repetă parola"
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

					<Button type="submit" disabled={loading} class="w-full" size="lg">
						<CheckIcon class="mr-2 size-4" />
						{loading ? 'Se creează contul...' : 'Creează cont și acceptă'}
					</Button>
				</form>

				<p class="mt-6 text-center text-sm text-muted-foreground">
					Ai deja cont?
					<a
						href="/login?redirect={encodeURIComponent('/invite/' + token)}"
						class="font-medium text-primary hover:underline"
					>
						Login aici
					</a>
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">Se încarcă invitația...</p>
			{/if}
		</div>
	</div>
</div>
