import { metrics } from '@opentelemetry/api';

// Metrici proprii CRM, exportate în Tracely. Cererile, erorile și latența HTTP vin
// deja din traces — aici doar ce e specific aplicației. No-op fără SDK pornit.
const meter = metrics.getMeter('crm');

/** Joburi scheduler terminate, pe `job.type` și `outcome` (completed | failed). */
export const schedulerJobs = meter.createCounter('crm.scheduler.jobs', { unit: '{job}' });

/** Durata unui job scheduler, pe `job.type` și `outcome`. */
export const schedulerJobDuration = meter.createHistogram('crm.scheduler.job.duration', { unit: 's' });
