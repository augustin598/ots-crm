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

/**
 * După cât timp fără semn de viață considerăm o rulare moartă. Cheia de progres din Redis
 * trăiește 30 de minute, dar un proces ucis (deploy, restart, crash) o lasă fără
 * `finishedAt` — iar UI-ul arăta la nesfârșit un banner „în curs" cu totalul vechi, și
 * orice verificare nouă primea 409 „deja în curs". Runner-ul rescrie cheia la fiecare
 * cuvânt, deci lipsa unei actualizări e semnalul corect, nu vechimea pornirii.
 * 5 minute > cel mai lung caz real pentru un singur cuvânt (3 pagini × pacing + timeout).
 */
export const RUN_STALE_MS = Number(env.RANK_RUN_STALE_MS ?? 300_000) || 300_000;
