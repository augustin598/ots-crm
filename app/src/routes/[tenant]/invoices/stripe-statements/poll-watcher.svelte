<script lang="ts">
	/**
	 * Poll cât timp Stripe are rulări în curs — și doar atunci.
	 *
	 * `active` vine ca prop (valoare deja rezolvată), nu ca query async citit din
	 * effect: așa intervalul pornește/se oprește curat, fără să depindă de
	 * momentul în care se așază derivatul asincron.
	 */
	let {
		active = false,
		intervalMs = 4000,
		maxMs = 5 * 60_000,
		ontick
	}: {
		active?: boolean;
		intervalMs?: number;
		maxMs?: number;
		ontick: () => void;
	} = $props();

	$effect(() => {
		if (!active) return;
		const startedAt = Date.now();
		const id = setInterval(() => {
			// Plasă de siguranță: o rulare blocată la Stripe nu ține pagina în poll la infinit.
			if (Date.now() - startedAt > maxMs) {
				clearInterval(id);
				return;
			}
			ontick();
		}, intervalMs);
		return () => clearInterval(id);
	});
</script>
