// Configurarea de rulare a Rank Tracker-ului, într-un singur loc: e citită și de runner,
// și de read model (ca UI-ul să poată eticheta corect „nu l-am găsit în primele N").
import { env } from '$env/dynamic/private';

/**
 * Câte poziții căutăm per cuvânt. De când Google nu mai acceptă `num=100`, scraperul
 * paginează din 10 în 10, deci `depth` = numărul MAXIM de cereri către Google per
 * (cuvânt × dispozitiv). Cu 100 ar însemna până la 10 cereri fiecare — la 8 s pacing
 * o rulare mică depășește 10 minute și se termină aproape sigur cu blocare.
 * 30 = 3 cereri, acoperă primele 3 pagini (unde se decid clicurile).
 * Căutarea se oprește oricum imediat ce domeniul țintă e găsit.
 */
export const SERP_DEPTH = Number(env.RANK_SERP_DEPTH ?? 30) || 30;
