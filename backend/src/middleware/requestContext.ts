import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export interface ContextRequest extends Request {
  requestId?: string;
}

export interface StructuredLogger {
  info(record: Record<string, unknown>): void;
  error(record: Record<string, unknown>): void;
}

export function createRequestContext(createId: () => string = randomUUID) {
  return (request: ContextRequest, response: Response, next: NextFunction) => {
    const requestId = createId();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  };
}

export function createAccessLogger(logger: StructuredLogger) {
  return (request: ContextRequest, response: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    response.once('finish', () => {
      logger.info({
        event: 'http_request',
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      });
    });
    next();
  };
}
