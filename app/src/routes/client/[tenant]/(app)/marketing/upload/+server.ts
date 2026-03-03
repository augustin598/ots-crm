import type { RequestHandler } from './$types';
import { handleMarketingUpload } from '$lib/server/marketing-upload';

export const POST: RequestHandler = async (event) => {
	return handleMarketingUpload(event);
};
