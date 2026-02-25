import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Google Favicon API URL for a website domain */
export function getFaviconUrl(websiteUrl: string, size = 128): string {
	try {
		const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
		const host = new URL(url).hostname.replace(/^www\./, '');
		return `https://www.google.com/s2/favicons?domain=${host}&sz=${size}`;
	} catch {
		return '';
	}
}

/** Clearbit Logo API URL – use as fallback when favicon fails */
export function getClearbitLogoUrl(websiteUrl: string): string {
	try {
		const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
		const host = new URL(url).hostname.replace(/^www\./, '');
		return `https://logo.clearbit.com/${host}`;
	} catch {
		return '';
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
