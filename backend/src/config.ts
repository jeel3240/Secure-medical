const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'EZT_USERNAME', 'EZT_PASSWORD'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

export const config = {
  databaseUrl: process.env.DATABASE_URL!,
  redisUrl: process.env.REDIS_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  ezt: { username: process.env.EZT_USERNAME!, password: process.env.EZT_PASSWORD! },
};
