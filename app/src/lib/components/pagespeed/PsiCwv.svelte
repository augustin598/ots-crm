<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';

	let { pass }: { pass: boolean | null } = $props();
</script>

{#if pass == null}
	<!-- CrUX = Chrome UX Report: Google publică date reale doar pentru site-urile cu
	     suficient trafic din Chrome; lipsa lor NU e o eroare a scanării -->
	<span
		class="psi-cwv na"
		title="Google nu publică date reale (Chrome UX Report) pentru acest site — trafic prea mic pe mobil. Scorul și metricile din stânga sunt din laborator (Lighthouse) și rămân valabile."
		>fără date CrUX</span
	>
{:else if pass}
	<span class="psi-cwv pass"><CheckIcon size={11} /> trece</span>
{:else}
	<span class="psi-cwv fail"><XIcon size={11} /> nu trece</span>
{/if}
