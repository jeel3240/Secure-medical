import type { ReactNode } from 'react';

type Tone = 'error' | 'warning' | 'info' | 'success';

export function Banner({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
