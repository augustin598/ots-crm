import type { RequestHandler } from './$types';
import { handleArticleUpload } from '$lib/server/marketing-upload';

export const POST: RequestHandler = async (event) => {
	return handleArticleUpload(event);
};
