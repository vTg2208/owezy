import { PoolClient } from 'pg';
import { getPool, withTransaction } from '../database';

export interface QueryResultLike {
  rows: Record<string, any>[];
  rowCount: number | null;
}

export interface QueryExecutor {
  query(text: string, values?: any[]): Promise<QueryResultLike>;
}

export type TransactionRunner = <T>(work: (database: QueryExecutor) => Promise<T>) => Promise<T>;

export function defaultDatabase(): QueryExecutor {
  return {
    query(text: string, values?: any[]) {
      return getPool().query(text, values);
    },
  };
}

export function defaultTransaction<T>(work: (database: QueryExecutor) => Promise<T>): Promise<T> {
  return withTransaction((client: PoolClient) => work(client));
}
