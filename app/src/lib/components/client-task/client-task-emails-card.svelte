<!-- src/lib/components/client-task/client-task-emails-card.svelte -->
<script lang="ts">
	// Card informativ „Emailuri asociate" în portalul clientului — arată că
	// task-ul se lucrează pe baza unui email. Serverul trimite în portal DOAR
	// {id, subject, emailDate} (fără expeditor/snippet/corp — inboxul e al
	// adminului), deci cardul e pur vizual, fără acțiuni.
	import MailIcon from '@lucide/svelte/icons/mail';

	type EmailInfo = { id: string; subject: string | null; emailDate: Date | string | null };

	let { emails = [] }: { emails?: EmailInfo[] } = $props();

	function fmtDate(d: Date | string | null) {
		if (!d) return '';
		return new Date(d).toLocaleDateString('ro-RO', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	}
</script>

{#if emails.length > 0}
	<div class="ct-emails mb-[22px] rounded-[14px] border border-[#e5e9f0] bg-white p-5">
		<div class="mb-3.5 flex items-center gap-2">
			<span
				class="grid h-7 w-7 place-items-center rounded-lg border border-[#e0e7ff] bg-[#eef2ff]"
			>
				<MailIcon class="h-[14px] w-[14px] text-[#4f46e5]" />
			</span>
			<span class="text-[13px] font-bold uppercase tracking-[0.04em] text-[#64748b]">
				Emailuri asociate
			</span>
			{#if emails.length > 1}
				<span class="text-[12px] font-semibold text-[#94a3b8]">({emails.length})</span>
			{/if}
		</div>

		<ul class="m-0 flex list-none flex-col gap-2.5 p-0">
			{#each emails as e (e.id)}
				<li
					class="rounded-[10px] border border-[#eef1f6] bg-[#fafbfd] px-4 py-3"
				>
					<p class="m-0 text-[14px] font-semibold leading-snug text-[#0f172a]">
						{e.subject || '(fără subiect)'}
					</p>
					{#if e.emailDate}
						<p class="m-0 mt-1 text-[12px] text-[#64748b]">
							Primit pe {fmtDate(e.emailDate)} — task creat din acest email
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}
