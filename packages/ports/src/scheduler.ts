export type CronHandler = (at: Date) => Promise<void> | void;

export interface Scheduler {
  registerCron(name: string, cron: string, handler: CronHandler): void;
}
