/**
 * Format user name for display
 * Returns "FirstName LastName" or email as fallback
 */
export function formatUserName(user: {
	firstName?: string | null;
	lastName?: string | null;
	email: string;
}): string {
	if (user.firstName && user.lastName) {
		return `${user.firstName} ${user.lastName}`.trim();
	}
	return user.email;
}

/**
 * Get user initials for avatar display
 */
export function getUserInitials(user: {
	firstName?: string | null;
	lastName?: string | null;
	email: string;
}): string {
	if (user.firstName && user.lastName) {
		return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
	}
	if (user.firstName) {
		return user.firstName[0].toUpperCase();
	}
	// Use email initials as fallback
	const emailPart = user.email.split('@')[0];
	return emailPart.substring(0, 2).toUpperCase();
}
