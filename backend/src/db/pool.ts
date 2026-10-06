import { Pool } from 'pg';
import { config } from '../config';

// RDS certs are signed by Amazon's CA, which Node does not trust by default, so
// a sslmode=require URL fails verification with "self signed certificate in
// certificate chain". rejectUnauthorized: false keeps the connection encrypted
// but skips the issuer check. Acceptable because RDS is only reachable from
// inside the VPC. Swap in the RDS CA bundle if strict verification is wanted.
// psql does not hit this because it does not verify by default.
//
// jit=off: Postgres compiles a query to machine code when it estimates it will
// be expensive, and it estimates that of the queue and Admin > Leads - one
// lookup per lead, which it prices far above what it costs. The compiling took
// longer than the query: 1.3 of 2.3 seconds for one page of Admin > Leads at
// 50,000 leads (2026-10-06). Nothing this app runs is the long analytical kind
// it exists for. docs/QUEUE.md, "How fast it is".
//
// connectionTimeoutMillis: a request that cannot get a connection fails after
// ten seconds, with an error in the logs, where the default is to wait for
// ever. If the pool is ever starved again, the API answers 500 and recovers
// instead of hanging silently until someone restarts it.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  options: '-c jit=off',
  connectionTimeoutMillis: 10_000,
});
