/** Icon registry mapping the design's icon names to @lucide/svelte components. */
import type { Component } from 'svelte';
import Activity from '@lucide/svelte/icons/activity';
import DollarSign from '@lucide/svelte/icons/dollar-sign';
import Eye from '@lucide/svelte/icons/eye';
import MousePointer from '@lucide/svelte/icons/mouse-pointer';
import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
import UserPlus from '@lucide/svelte/icons/user-plus';
import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
import TrendingUp from '@lucide/svelte/icons/trending-up';
import Repeat from '@lucide/svelte/icons/repeat';
import Heart from '@lucide/svelte/icons/heart';
import ThumbsUp from '@lucide/svelte/icons/thumbs-up';
import Star from '@lucide/svelte/icons/star';
import Send from '@lucide/svelte/icons/send';
import Video from '@lucide/svelte/icons/video';
import Phone from '@lucide/svelte/icons/phone';
import MessageCircle from '@lucide/svelte/icons/message-circle';
import FileText from '@lucide/svelte/icons/file-text';
import Users from '@lucide/svelte/icons/users';
import Calendar from '@lucide/svelte/icons/calendar';
import Globe from '@lucide/svelte/icons/globe';
import Target from '@lucide/svelte/icons/target';
import CreditCard from '@lucide/svelte/icons/credit-card';
import Megaphone from '@lucide/svelte/icons/megaphone';
import Image from '@lucide/svelte/icons/image';
import Layers from '@lucide/svelte/icons/layers';
import Sliders from '@lucide/svelte/icons/sliders-horizontal';
import Download from '@lucide/svelte/icons/download';

export const RK_ICONS: Record<string, Component> = {
	Activity,
	DollarSign,
	Eye,
	MousePointer,
	MousePointerClick,
	UserPlus,
	ShoppingBag,
	ShoppingCart,
	TrendingUp,
	Repeat,
	Heart,
	ThumbsUp,
	Star,
	Send,
	Video,
	Phone,
	MessageCircle,
	FileText,
	Users,
	Calendar,
	Globe,
	Target,
	CreditCard,
	Megaphone,
	Image,
	Layers,
	Sliders,
	Download
};

export function rkIcon(name: string | undefined): Component {
	return (name && RK_ICONS[name]) || Activity;
}
