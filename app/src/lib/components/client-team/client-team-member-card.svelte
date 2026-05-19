<!-- src/lib/components/client-team/client-team-member-card.svelte -->
<script lang="ts">
	import ContactAvatar from '$lib/components/ui/contact-avatar.svelte';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';

	type Props = {
		id: string;
		firstName: string | null;
		lastName: string | null;
		email: string | null;
		phone?: string | null;
		title?: string | null;
		roleLabel: string;
		roleColor: string;
		roleBg: string;
		online: boolean;
		lastActive?: string | null;
		addedAt: Date | string | null;
		onEmailClick?: () => void;
		onMessageClick?: () => void;
		onMenuClick?: () => void;
	};

	let {
		id,
		firstName,
		lastName,
		email,
		phone,
		title,
		roleLabel,
		roleColor,
		roleBg,
		online,
		lastActive,
		addedAt,
		onEmailClick,
		onMessageClick,
		onMenuClick
	}: Props = $props();

	const name = $derived(`${firstName ?? ''} ${lastName ?? ''}`.trim() || email || id);

	function fmtAdded(d: Date | string | null): string {
		if (!d) return '—';
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<article class="cteam-card relative flex flex-col gap-3 rounded-[14px] border border-[#e5e9f0] bg-white p-4 transition-all hover:border-[#1877F2] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)]">
	{#if onMenuClick}
		<button
			type="button"
			class="cteam-card-menu absolute right-3 top-3 grid h-6 w-6 place-items-center rounded text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
			onclick={onMenuClick}
			aria-label="Acțiuni"
		>
			<MoreVerticalIcon class="h-3.5 w-3.5" />
		</button>
	{/if}

	<div class="cteam-card-head flex items-center gap-3 pr-7">
		<div class="cteam-av relative shrink-0">
			<ContactAvatar
				src={null}
				name={name}
				phoneE164={email ?? id}
				size="lg"
			/>
			<span
				class={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${online ? 'bg-[#10b981]' : 'bg-[#cbd5e1]'}`}
				aria-label={online ? 'Online' : 'Offline'}
			></span>
		</div>
		<div class="min-w-0 flex-1">
			<div class="cteam-card-name truncate text-[14px] font-bold text-[#0f172a]">{name}</div>
			{#if title}
				<div class="cteam-card-title truncate text-[12px] text-[#64748b]">{title}</div>
			{/if}
		</div>
	</div>

	<span
		class="cteam-pill inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.02em]"
		style:background-color={roleBg}
		style:color={roleColor}
	>
		<span class="dot h-1.5 w-1.5 rounded-full" style:background-color={roleColor}></span>
		{roleLabel}
	</span>

	<div class="cteam-card-meta flex flex-col gap-1.5 border-t border-b border-[#f1f5f9] py-3 text-[12.5px]">
		{#if email}
			<div class="cteam-card-meta-row flex items-center gap-2 text-[#475569]">
				<MailIcon class="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
				<a href={`mailto:${email}`} class="truncate hover:text-[#0f172a]">{email}</a>
			</div>
		{/if}
		{#if phone}
			<div class="cteam-card-meta-row flex items-center gap-2 text-[#475569]">
				<PhoneIcon class="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
				<a href={`tel:${phone}`} class="hover:text-[#0f172a]">{phone}</a>
			</div>
		{/if}
		<div class="cteam-card-meta-row flex items-center gap-2 text-[#475569]">
			<ClockIcon class="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			{#if online}
				<span class="font-semibold text-[#10b981]">Online acum</span>
			{:else if lastActive}
				<span>Activ ultima oară: {lastActive}</span>
			{:else}
				<span class="text-[#94a3b8]">—</span>
			{/if}
		</div>
	</div>

	<div class="cteam-card-foot flex items-center justify-between">
		<span class="cteam-card-since text-[11px] text-[#94a3b8]">Adăugat {fmtAdded(addedAt)}</span>
		<div class="cteam-card-quick flex gap-1">
			{#if onEmailClick}
				<button
					type="button"
					class="cteam-q-btn grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#e5e9f0] bg-white text-[#475569] hover:border-[#1877F2] hover:text-[#1877F2]"
					title="Email"
					onclick={onEmailClick}
					aria-label="Trimite email"
				>
					<MailIcon class="h-3 w-3" />
				</button>
			{/if}
			{#if onMessageClick}
				<button
					type="button"
					class="cteam-q-btn grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#e5e9f0] bg-white text-[#475569] hover:border-[#1877F2] hover:text-[#1877F2]"
					title="Mesaj"
					onclick={onMessageClick}
					aria-label="Trimite mesaj"
				>
					<MessageCircleIcon class="h-3 w-3" />
				</button>
			{/if}
		</div>
	</div>
</article>
