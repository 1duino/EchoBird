import { useEffect, useState } from 'react';

// Advance cached quota countdowns locally. Network refreshes remain explicit.
export function useUsageClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [active]);
  return now;
}
