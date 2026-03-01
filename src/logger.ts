import { createConsola } from 'consola';

const LOG_LEVEL_MAP: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 3,
  debug: 4,
};

const level = LOG_LEVEL_MAP[process.env.LOG_LEVEL ?? 'info'] ?? 3;

const consola = createConsola({
  level,
  fancy: true,
  formatOptions: {
    date: true,
  },
});

export function createLogger(tag: string) {
  return consola.withTag(tag);
}
