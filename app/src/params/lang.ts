import type { ParamMatcher } from '@sveltejs/kit';

export const match = ((param: string): param is 'ro' | 'en' => {
	return param === 'ro' || param === 'en';
}) satisfies ParamMatcher;
