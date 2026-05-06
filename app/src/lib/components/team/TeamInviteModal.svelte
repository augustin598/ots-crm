<script lang="ts" generics="RoleId extends string, DeptId extends string">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TeamRoleGrid from './TeamRoleGrid.svelte';
	import type { RoleDef, DepartmentDef } from '$lib/config/team';

	let {
		open = $bindable(false),
		title = 'Invită membru nou',
		description = '',
		roles,
		defaultRole,
		showTitle = false,
		departments = null,
		defaultDepartment = null,
		showWelcomeMessage = false,
		submitLabel = 'Trimite invitație',
		submit
	}: {
		open: boolean;
		title?: string;
		description?: string;
		roles: ReadonlyArray<RoleDef<RoleId>>;
		defaultRole: RoleId;
		showTitle?: boolean;
		departments?: ReadonlyArray<DepartmentDef> | null;
		defaultDepartment?: DeptId | null;
		showWelcomeMessage?: boolean;
		submitLabel?: string;
		submit: (data: {
			email: string;
			jobTitle?: string;
			role: RoleId;
			department?: DeptId | null;
			welcomeMessage?: string;
		}) => Promise<void>;
	} = $props();

	let email = $state('');
	let jobTitle = $state('');
	let role = $state<RoleId>(defaultRole);
	let department = $state<DeptId | null>(defaultDepartment);
	let welcome = $state('');
	let busy = $state(false);
	let errorMsg = $state<string | null>(null);

	$effect(() => {
		if (open) {
			email = '';
			jobTitle = '';
			role = defaultRole;
			department = defaultDepartment;
			welcome = '';
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
			await submit({
				email: trimmed,
				jobTitle: showTitle ? jobTitle.trim() || undefined : undefined,
				role,
				department: departments ? department : undefined,
				welcomeMessage: showWelcomeMessage ? welcome.trim() || undefined : undefined
			});
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
				<Label for="invite-email" class="invite-lbl">EMAIL</Label>
				<Input
					id="invite-email"
					type="email"
					bind:value={email}
					placeholder="nume@onetopsolution.ro"
					required
					autocomplete="off"
				/>
			</div>
			{#if departments || showTitle}
				<div class="grid gap-3" style="grid-template-columns:{departments && showTitle ? '1fr 1fr' : '1fr'}">
					{#if departments}
						<div class="space-y-1.5">
							<Label for="invite-dept" class="invite-lbl">DEPARTAMENT</Label>
							<select
								id="invite-dept"
								class="dept-select"
								value={department ?? ''}
								onchange={(e) => {
									const v = (e.currentTarget as HTMLSelectElement).value;
									department = (v === '' ? null : v) as DeptId | null;
								}}
							>
								<option value="">— Fără —</option>
								{#each departments as d (d.id)}
									<option value={d.id}>{d.label}</option>
								{/each}
							</select>
						</div>
					{/if}
					{#if showTitle}
						<div class="space-y-1.5">
							<Label for="invite-title" class="invite-lbl">TITLU</Label>
							<Input id="invite-title" bind:value={jobTitle} placeholder="ex: Ads Specialist" />
						</div>
					{/if}
				</div>
			{/if}
			<div class="space-y-1.5">
				<Label class="invite-lbl">ROL</Label>
				<TeamRoleGrid {roles} bind:value={role} />
			</div>
			{#if showWelcomeMessage}
				<div class="space-y-1.5">
					<Label for="invite-welcome" class="invite-lbl">MESAJ DE BUN VENIT (OPȚIONAL)</Label>
					<textarea
						id="invite-welcome"
						bind:value={welcome}
						rows={3}
						placeholder="Bun venit în echipă!"
						class="welcome-area"
					></textarea>
				</div>
			{/if}
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

<style>
	:global(.invite-lbl) {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.dept-select {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card);
		color: var(--foreground);
		font-size: 14px;
		font-family: inherit;
		appearance: none;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>");
		background-repeat: no-repeat;
		background-position: right 10px center;
		background-size: 14px 14px;
		padding-right: 32px;
	}
	.dept-select:focus {
		outline: none;
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.welcome-area {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card);
		color: var(--foreground);
		font-size: 14px;
		font-family: inherit;
		resize: vertical;
		min-height: 70px;
	}
	.welcome-area:focus {
		outline: none;
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
</style>
