<script lang="ts">
	import { psiFmt, psiMetricLevel, type PsiMetricKey } from '$lib/logic/pagespeed';

	let { k, v }: { k: PsiMetricKey; v: number | null } = $props();

	const lvl = $derived(psiMetricLevel(k, v));
</script>

<span class="psi-metric psi-{lvl}"><span class="sq psi-sq-{lvl}"></span>{psiFmt(k, v)}</span>
