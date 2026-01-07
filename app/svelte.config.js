import adapter from './adapter';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: [vitePreprocess()],
	kit: {
		adapter: adapter({ precompress: true }),
		experimental: { remoteFunctions: true },
		csrf: {
			trustedOrigins: [
				'https://beta.navitech.systems',
				'https://navitech.systems',
				'https://localhost:3000'
			]
		}
	},
	compilerOptions: {
		experimental: {
			async: true
		}
	}
};

export default config;
