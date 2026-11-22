/** A lead's page made afresh for each lead (review H6). */
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const lifecycle: string[] = [];
vi.mock('./WorkspacePage', () => ({
  WorkspacePage: () => {
    // A page that keeps its own state, as the real one does: mounted once per lead.
    useEffect(() => {
      lifecycle.push('mount');
      return () => {
        lifecycle.push('unmount');
      };
    }, []);
    return null;
  },
}));

const { LeadWorkspaceRoute } = await import('./LeadWorkspaceRoute');

describe('going from one lead\'s page to another', () => {
  it('the first page goes, and the second starts afresh - nothing of the first lead carried over', async () => {
    let navigate: NavigateFunction = () => undefined;
    function Steer() {
      navigate = useNavigate();
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/leads/1']}>
        <Steer />
        <Routes>
          <Route path="/leads/:id" element={<LeadWorkspaceRoute />} />
        </Routes>
      </MemoryRouter>
    );
    expect(lifecycle).toEqual(['mount']);
    await act(async () => navigate('/leads/2'));
    expect(lifecycle).toEqual(['mount', 'unmount', 'mount']);
  });
});
