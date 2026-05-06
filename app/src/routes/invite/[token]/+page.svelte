<script lang="ts">
	import type { PageData } from './$types';
	import { acceptInvitation } from '$lib/remotes/invitations.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { getAdminRole, getDepartment } from '$lib/config/team';
	import MailIcon from '@lucide/svelte/icons/mail';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import CheckIcon from '@lucide/svelte/icons/check';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	let { data }: { data: PageData } = $props();

	const token = $derived(page.params.token || '');
	let accepting = $state(false);
	let error = $state<string | null>(null);

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
	const expiresLabel = $derived.by(() => {
		if (!inv?.expiresAt) return null;
		return new Intl.DateTimeFormat('ro-RO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(inv.expiresAt));
	});

	async function handleAccept() {
		accepting = true;
		error = null;
		try {
			const result = await acceptInvitation(token);
			if (result.success && result.tenantSlug) {
				goto(`/${result.tenantSlug}`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Acceptarea invitației a eșuat.';
		} finally {
			accepting = false;
		}
	}
</script>

<svelte:head>
	<title>{tenant?.name ? `${tenant.name} — Invitație` : 'Invitație'}</title>
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
				<span class="text-sm font-medium">Invitație nouă în echipă</span>
			</div>
		</div>
	</div>

	<!-- Right: invitation card -->
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
			{:else if inv && data.alreadyMember}
				<div class="space-y-4">
					<div class="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-5 dark:border-blue-800 dark:bg-blue-950">
						<CheckIcon class="mt-0.5 size-5 shrink-0 text-blue-600 dark:text-blue-400" />
						<div>
							<p class="font-medium text-blue-900 dark:text-blue-100">Ești deja membru</p>
							<p class="mt-1 text-sm text-blue-800 dark:text-blue-200">
								Faci deja parte din <strong>{tenant?.name}</strong>. Nu este nevoie să accepți din nou.
							</p>
						</div>
					</div>
					<Button
						onclick={() => goto(`/${data.memberTenantSlug ?? tenant?.slug ?? ''}`)}
						class="w-full"
						size="lg"
					>
						Mergi la workspace
					</Button>
				</div>
			{:else if inv && data.emailMismatch}
				<div class="space-y-4">
					<div class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950">
						<AlertTriangleIcon class="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
						<div class="space-y-2">
							<p class="font-medium text-amber-900 dark:text-amber-100">Cont greșit</p>
							<p class="text-sm text-amber-800 dark:text-amber-200">
								Această invitație a fost trimisă către <strong>{inv.email}</strong>, dar
								ești logat ca <strong>{data.loggedInEmail}</strong>.
							</p>
							<p class="text-sm text-amber-800 dark:text-amber-200">
								Deconectează-te și loghează-te cu contul corect pentru a accepta.
							</p>
						</div>
					</div>
					<Button
						onclick={() =>
							goto('/login?redirect=' + encodeURIComponent('/invite/' + token))}
						class="w-full"
						size="lg"
						variant="outline"
					>
						<LogInIcon class="mr-2 size-4" />
						Deconectează-te și loghează cu altul cont
					</Button>
				</div>
			{:else if inv}
				<div class="space-y-2 mb-8">
					<h1 class="text-2xl font-bold tracking-tight">Bun venit în echipă!</h1>
					<p class="text-sm text-muted-foreground">
						Ai fost invitat să te alături organizației.
					</p>
				</div>

				<!-- Invitation details card -->
				<div class="rounded-xl border border-border bg-card p-5 space-y-4 mb-6">
					<div class="space-y-1">
						<p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Te-a invitat
						</p>
						<p class="text-sm font-medium text-foreground">{inviterName}</p>
					</div>

					<div class="space-y-1">
						<p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Organizație
						</p>
						<p class="text-base font-bold text-foreground">{tenant?.name ?? '—'}</p>
					</div>

					<div class="flex flex-wrap gap-2 pt-1">
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

					<div class="flex items-center gap-2 text-xs text-muted-foreground border-t pt-3">
						<MailIcon class="size-3.5" />
						<span>{inv.email}</span>
						{#if expiresLabel}
							<span class="ml-auto">expiră {expiresLabel}</span>
						{/if}
					</div>
				</div>

				{#if error}
					<div class="rounded-lg border border-red-200 bg-red-50 p-3 mb-4 dark:border-red-800 dark:bg-red-950">
						<p class="text-sm text-red-700 dark:text-red-300">{error}</p>
					</div>
				{/if}

				<div class="space-y-3">
					{#if data.isLoggedIn}
						<Button onclick={handleAccept} disabled={accepting} class="w-full" size="lg">
							<CheckIcon class="mr-2 size-4" />
							{accepting ? 'Se acceptă...' : 'Acceptă invitația'}
						</Button>
						<p class="text-center text-xs text-muted-foreground">
							Vei fi redirecționat către workspace după acceptare.
						</p>
					{:else}
						<Button
							onclick={() => goto('/invite/' + token + '/signup')}
							class="w-full"
							size="lg"
						>
							<UserPlusIcon class="mr-2 size-4" />
							Creează cont și acceptă
						</Button>

						<div class="relative my-2">
							<div class="absolute inset-0 flex items-center">
								<span class="w-full border-t"></span>
							</div>
							<div class="relative flex justify-center text-xs uppercase">
								<span class="bg-background px-2 text-muted-foreground">sau</span>
							</div>
						</div>

						<Button
							variant="outline"
							onclick={() =>
								goto('/login?redirect=' + encodeURIComponent('/invite/' + token))}
							class="w-full"
							size="lg"
						>
							<LogInIcon class="mr-2 size-4" />
							Am deja cont — Login
						</Button>
					{/if}
				</div>

				<p class="mt-6 text-center text-xs text-muted-foreground">
					Linkul este personal — nu îl distribui altor persoane.
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">Se încarcă invitația...</p>
			{/if}
		</div>
	</div>
</div>
