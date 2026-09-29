import { useEffect, useState } from 'react';

/**
 * The current time, re-rendering every second - for a waiting time or a lead's
 * age that has to tick. The queue and the workspace each had an identical copy
 * until 2026-09-28.
 */
export function useSecond(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
