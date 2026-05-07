export interface CleanupJobData {
  negocioId: string;
  cutoffDays: number;
  requestedAt: string;
}

export async function processCleanupJob(job: CleanupJobData): Promise<{ cleaned: number }> {
  console.log(`[worker] cleanup for business ${job.negocioId} cutoff=${job.cutoffDays}`);
  return { cleaned: 0 };
}

