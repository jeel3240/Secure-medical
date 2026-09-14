const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'EZT_USERNAME', 'EZT_PASSWORD', 'EZT_GROUP'];
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
  ezt: {
    username: process.env.EZT_USERNAME!,
    password: process.env.EZT_PASSWORD!,
    // The account holds ~120k real contacts; every contacts query must be
    // scoped to this group.
    group: process.env.EZT_GROUP!,
    // Partner leads arrive as API. Contacts added by hand in the EZ Texting
    // dashboard arrive as WebInterface, so set this to WebInterface locally
    // to test with a contact you added yourself.
    source: process.env.EZT_SOURCE ?? 'API',
    // Deliberately separate from the poll group, and deliberately not in
    // `required`: with no dev-test group to send to yet, leaving it unset
    // keeps sendMessage from texting real leads.
    sendGroup: process.env.EZT_SEND_GROUP ?? '',
  },
};
