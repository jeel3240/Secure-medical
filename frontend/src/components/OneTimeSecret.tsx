import { useState } from 'react';
import { Banner } from './Banner';
import { Button } from './Button';

/** Shows a temporary password with a copy button and a clear once-only warning. */
export function OneTimeSecret({ value, forName }: { value: string; forName: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the value is selectable, so copying by hand still works.
    }
  }

  return (
    <div className="secret">
      <Banner tone="warning">
        This temporary password is shown only once. Give it to {forName} now. They will set their own password when
        they first sign in.
      </Banner>
      <div className="secret__row">
        <output className="secret__value" aria-label="Temporary password" data-testid="temporary-password">
          {value}
        </output>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
