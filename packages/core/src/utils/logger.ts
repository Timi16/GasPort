import pino from 'pino';

export interface LoggerOptions {
  level?: 'debug' | 'info' | 'warn' | 'error';
  pretty?: boolean;
}

/**
 * Create a logger instance
 */
export function createLogger(options: LoggerOptions = {}) {
  const { level = 'info', pretty = process.env.NODE_ENV !== 'production' } = options;

  return pino({
    level,
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  });
}
