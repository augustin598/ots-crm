<script lang="ts">
	// Previzualizarea raportului săptămânal — port 1:1 din design (PSIMailPreview),
	// cu aceleași agregate pe care le folosește emailul real (getPagespeedReportPreview).
	import MailIcon from '@lucide/svelte/icons/mail';
	import XIcon from '@lucide/svelte/icons/x';
	import SendIcon from '@lucide/svelte/icons/send';
	import { getPagespeedReportPreview } from '$lib/remotes/pagespeed.remote';
	import { psiDialog } from './lib';
	import { PSI_DAYS, psiFmt, psiScoreLevel } from '$lib/logic/pagespeed';
	import type { PsiSettings } from './types';

	let {
		settings,
		sending = false,
		onclose,
		onsend
	}: {
		settings: PsiSettings;
		sending?: boolean;
		onclose: () => void;
		onsend: () => void;
	} = $props();

	const previewQuery = $derived(getPagespeedReportPreview());
	const data = $derived(previewQuery.current);
	const dayName = $derived(PSI_DAYS[settings.dayOfWeek - 1] ?? 'Luni');
	const alerts = $derived(data ? data.rows.filter((r) => r.alert) : []);
</script>

<div class="psi-modal-back" onclick={onclose} role="presentation">
	<div
		class="psi-modal lg"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Escape') onclose();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		{@attach psiDialog}
		aria-label="Previzualizare raport săptămânal"
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><MailIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">Previzualizare raport săptămânal</div>
				<div class="psi-modal-sub">
					către {settings.recipients.length ? settings.recipients.join(', ') : '— niciun destinatar —'} · {dayName}
					{settings.hour} (Europe/Bucharest)
				</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			{#if previewQuery.loading && !data}
				<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">Se generează previzualizarea…</div>
			{:else if previewQuery.error}
				<div class="psi-mail-alert">Previzualizarea nu a putut fi generată. Încearcă din nou.</div>
			{:else if data}
				<div class="psi-mail">
					<div class="psi-mail-head">
						<h4>Raport PageSpeed Insights — {data.weekLabel}</h4>
						<p>Săptămâna {data.interval} · {data.siteCount} site-uri scanate · One Top Solution</p>
					</div>
					<div class="psi-mail-kpis">
						<div class="psi-mail-kpi">
							<span>Scor mediu mobil</span><b class="psi-{psiScoreLevel(data.avgMobile)}">{data.avgMobile ?? '—'}</b>
						</div>
						<div class="psi-mail-kpi">
							<span>Scor mediu desktop</span><b class="psi-{psiScoreLevel(data.avgDesktop)}">{data.avgDesktop ?? '—'}</b>
						</div>
						<div class="psi-mail-kpi">
							<span>Δ vs săpt. trecută</span><b>{data.deltaMobile == null ? '—' : `${data.deltaMobile > 0 ? '+' : ''}${data.deltaMobile}`}</b>
						</div>
						<div class="psi-mail-kpi">
							<span>Trec Core Web Vitals</span><b>{data.cwvPassCount}/{data.cwvKnownCount || data.siteCount}</b>
						</div>
					</div>
					<div class="psi-mail-body">
						<table class="psi-mail-table">
							<thead>
								<tr>
									<th>Site</th><th class="r">Mobil</th><th class="r">Δ</th><th class="r">Desktop</th>
									<th class="r">LCP</th><th class="r">CLS</th><th class="r">CWV</th>
								</tr>
							</thead>
							<tbody>
								{#each data.rows as r (r.siteId)}
									<tr>
										<td>
											<b>{r.domain}</b>
											{#if r.failed}<span class="psi-tag danger" style="margin-left: 6px">eșuat</span>{/if}
											<div style="font-size: 11px; color: var(--cl-text-3)">{r.clientName ?? ''}</div>
										</td>
										<td class="r psi-{psiScoreLevel(r.mobile)}" style="font-weight: 800">{r.mobile ?? '—'}</td>
										<td class="r">{r.deltaMobile == null ? '—' : `${r.deltaMobile > 0 ? '+' : ''}${r.deltaMobile}`}</td>
										<td class="r psi-{psiScoreLevel(r.desktop)}" style="font-weight: 700">{r.desktop ?? '—'}</td>
										<td class="r">{r.lcpMs != null ? psiFmt('lcp', r.lcpMs) : '—'}</td>
										<td class="r">{r.cls != null ? psiFmt('cls', r.cls) : '—'}</td>
										<td class="r">{r.cwv == null ? '—' : r.cwv ? 'trece' : 'nu trece'}</td>
									</tr>
								{:else}
									<tr><td colspan="7" style="text-align: center; color: var(--cl-text-3); padding: 20px 0">Niciun site activ cu măsurători.</td></tr>
								{/each}
							</tbody>
						</table>
						{#if alerts.length > 0}
							<div class="psi-mail-alert">
								<b>{alerts.length} {alerts.length === 1 ? 'site a scăzut' : 'site-uri au scăzut'} peste pragul de alertă</b>
								{#each alerts as a (a.siteId)}
									<div>
										{a.domain}: {a.mobile} pe mobil ({a.deltaMobile} puncte){a.topOpportunity
											? ` — ${a.topOpportunity.toLowerCase()}`
											: ''}
									</div>
								{/each}
							</div>
						{/if}
						{#if settings.includeOpportunities}
							<p class="cl-hint" style="margin-top: 14px">
								Raportul include primele 3 oportunități PageSpeed pentru fiecare site sub 90 puncte{settings.attachPdf
									? ' și PDF-ul complet atașat'
									: ''}.
							</p>
						{/if}
					</div>
					<div class="psi-mail-foot">
						Trimis automat de OTS CRM · sursa datelor: Google PageSpeed Insights API v5 (Lighthouse + CrUX) ·
						dezabonare din Setări &gt; Rapoarte
					</div>
				</div>
			{/if}
		</div>
		<div class="psi-modal-foot">
			<button class="cl-btn-secondary" onclick={onclose}>Închide</button>
			<button class="cl-btn-primary" disabled={sending || !settings.recipients.length} onclick={onsend}>
				<SendIcon size={13} /> Trimite acum
			</button>
		</div>
	</div>
</div>
