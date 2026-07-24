<script lang="ts">
	import { page } from '$app/state';
	import ArticleEditorView from '$lib/components/content/article-editor-view.svelte';

	const tenant = $derived(page.params.tenant as string);
</script>

<ArticleEditorView basePath={`/client/${tenant}/content`} />
