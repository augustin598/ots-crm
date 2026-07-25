import type { RequestHandler } from './$types';
import { handleContentImageUpload } from '$lib/server/content/content-media';

export const POST: RequestHandler = (event) => handleContentImageUpload(event);
