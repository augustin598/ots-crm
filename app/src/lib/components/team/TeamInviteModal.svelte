<script lang="ts" generics="RoleId extends string">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TeamRoleGrid from './TeamRoleGrid.svelte';
	import type { RoleDef } from '$lib/config/team';

	let {
		open = $bindable(false),
		title = 'Invită membru',
		description = '',
		roles,
		defaultRole,
		showTitle = false,
		submitLabel = 'Trimite invitație',
		submit
	}: {
		open: boolean;
		title?: string;
		description?: string;
		roles: ReadonlyArray<RoleDef<RoleId>>;
		defaultRole: RoleId;
		showTitle?: boolean;
		submitLabel?: string;
		submit: (data: { email: string; jobTitle?: string; role: RoleId }) => Promise<void>;
	} = $props();

	let email = $state('');
	let jobTitle = $state('');
	let role = $state<RoleId>(defaultRole);
	let busy = $state(false);
	let errorMsg = $state<string | null>(null);

	$effect(() => {
		if (open) {
			email = '';
			jobTitle = '';
			role = defaultRole;
			busy = false;
			errorMsg = null;
		}
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		errorMsg = null;
		const trimmed = email.trim();
		if (!trimmed) {
			errorMsg = 'Adresa de email este obligatorie.';
			return;
		}
		busy = true;
		try {
			await submit({ email: trimmed, jobTitle: showTitle ? jobTitle.trim() || undefined : undefined, role });
			open = false;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Eroare la trimiterea invitației.';
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[560px]">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if description}
				<Dialog.Description>{description}</Dialog.Description>
			{/if}
		</Dialog.Header>
		<form onsubmit={handleSubmit} class="space-y-4">
			<div class="space-y-1.5">
				<Label for="invite-email">Email</Label>
				<Input
					id="invite-email"
					type="email"
					bind:value={email}
					placeholder="coleg@exemplu.ro"
					required
					autocomplete="off"
				/>
			</div>
			{#if showTitle}
				<div class="space-y-1.5">
					<Label for="invite-title">Titlu / Funcție (opțional)</Label>
					<Input id="invite-title" bind:value={jobTitle} placeholder="ex: Marketing Specialist" />
				</div>
			{/if}
			<div class="space-y-1.5">
				<Label>Rol</Label>
				<TeamRoleGrid {roles} bind:value={role} />
			</div>
			{#if errorMsg}
				<div class="text-sm text-destructive">{errorMsg}</div>
			{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={busy}>
					Anulează
				</Button>
				<Button type="submit" disabled={busy}>
					<PlusIcon class="mr-2 size-4" />
					{busy ? 'Se trimite...' : submitLabel}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
