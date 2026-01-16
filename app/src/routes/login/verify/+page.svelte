<script lang="ts">
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
</script>

<svelte:head>
	<title>Verifying Magic Link - DAVFOR GROUP</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-md">
		<CardHeader class="space-y-1">
			<CardTitle class="text-2xl font-bold">Verifying Your Magic Link</CardTitle>
			<CardDescription>Please wait while we verify your login link...</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="flex items-center justify-center py-8">
				<div class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
			</div>
		</CardContent>
	</Card>
</div>
