import { useState, type FormEvent } from 'react';
import { toApiError } from '../../api/client';
import type { PublicUser, Role } from '../../api/types';
import { createUser } from '../../api/users';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Drawer } from '../../components/Drawer';
import { OneTimeSecret } from '../../components/OneTimeSecret';
import { TextField } from '../../components/TextField';

interface Props {
  onClose: () => void;
  onCreated: (user: PublicUser) => void;
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'agent', label: 'Agent' },
  { value: 'superadmin', label: 'Superadmin' },
];

export function AddAgentDrawer({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ user: PublicUser; temporaryPassword: string } | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError('Enter a name and an email.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createUser({ name: name.trim(), email: email.trim(), role });
      setCreated(result);
      onCreated(result.user);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    // No backdrop or Escape dismissal here: closing loses the password for good,
    // so it takes a deliberate click.
    return (
      <Drawer
        key="created"
        title="Agent created"
        footer={
          <Button onClick={onClose} autoFocus>
            Done
          </Button>
        }
      >
        <p>
          <strong>{created.user.name}</strong> ({created.user.email}) can now sign in as{' '}
          {created.user.role === 'superadmin' ? 'a superadmin' : 'an agent'}.
        </p>
        <OneTimeSecret value={created.temporaryPassword} forName={created.user.name} />
      </Drawer>
    );
  }

  return (
    <Drawer
      key="form"
      title="Add agent"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-agent-form" loading={submitting}>
            Create account
          </Button>
        </>
      }
    >
      <form id="add-agent-form" className="auth-card__form" style={{ marginTop: 0 }} onSubmit={handleSubmit} noValidate>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <TextField label="Name" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        <TextField
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          hint="They sign in with this."
        />
        <div className="field">
          <span className="field__label" id="add-agent-role">
            Role
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="add-agent-role">
            {ROLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={role === option.value}
                className="segmented__option"
                onClick={() => setRole(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="field__hint">
            {role === 'superadmin'
              ? 'Full access, including Admin and every agent’s activity.'
              : 'Works the queue. No access to Admin.'}
          </span>
        </div>
        <p className="field__hint">A temporary password is generated and shown once after you create the account.</p>
      </form>
    </Drawer>
  );
}
