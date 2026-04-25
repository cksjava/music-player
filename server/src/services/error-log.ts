export interface ErrorLogEntry {
  id: string;
  time: number;
  scope: string;
  message: string;
  detail?: string;
}

const MAX_LOGS = 300;
const logs: ErrorLogEntry[] = [];

export function pushErrorLog(scope: string, message: string, detail?: string): void {
  logs.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: Date.now(),
    scope,
    message,
    detail,
  });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
}

export function getErrorLogs(limit = 100): ErrorLogEntry[] {
  return logs.slice(0, Math.max(1, Math.min(limit, MAX_LOGS)));
}

export function clearErrorLogs(): void {
  logs.length = 0;
}
