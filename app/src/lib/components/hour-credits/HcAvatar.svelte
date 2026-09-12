<script lang="ts">
	import { avatarColor, initialsOf } from './hour-credits-format';

	let { id, name, lg = false }: { id: string; name: string; lg?: boolean } = $props();
</script>

<!-- Decorativ: numele clientului e scris alături, deci avatarul nu-l repetă. -->
<div class="hc-av" class:lg style:background={avatarColor(id)} aria-hidden="true">
	{initialsOf(name)}
</div>
