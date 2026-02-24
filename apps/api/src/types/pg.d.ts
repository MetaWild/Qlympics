declare module 'pg' {
  export type QueryResultRow = Record<string, unknown>;

  export interface QueryResult<R extends QueryResultRow = QueryResultRow> {
    rows: R[];
    rowCount?: number | null;
  }

  export interface PoolClient {
    query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
    release(): void;
  }

  export class Pool {
    constructor(config?: unknown);
    connect(): Promise<PoolClient>;
    query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }
}
