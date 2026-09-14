import { Pool } from 'pg';
import { config } from '../config';

// RDS certs are signed by Amazon's CA, which Node does not trust by default, so
// a sslmode=require URL fails verification with "self signed certificate in
// certificate chain". rejectUnauthorized: false keeps the connection encrypted
// but skips the issuer check. Acceptable because RDS is only reachable from
// inside the VPC. Swap in the RDS CA bundle if strict verification is wanted.
// psql does not hit this because it does not verify by default.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});
