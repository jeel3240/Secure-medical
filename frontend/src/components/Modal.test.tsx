/**
 * Keyboard focus in a dialog - review Q8, 2026-11-23. Until then focus stayed
 * on the page behind the overlay: after choosing DNC, a keyboard user's next
 * keys went to the page, not the dialog asking them to confirm.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Drawer } from './Drawer';
import { Modal } from './Modal';

function Opener({ withField = false }: { withField?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Modal
          title="Block this number?"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button onClick={() => setOpen(false)}>Cancel</button>
              <button>Block</button>
            </>
          }
        >
          {withField ? <input aria-label="Reason" /> : <p>It cannot be undone from the app.</p>}
        </Modal>
      )}
    </>
  );
}

describe('a dialog and the keyboard', () => {
  it('takes focus when it opens: its first control', () => {
    render(<Opener />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByText('Cancel'));
  });

  it('a field before the buttons', () => {
    render(<Opener withField />);
    fireEvent.click(screen.getByText('Open'));
    expect(document.activeElement).toBe(screen.getByLabelText('Reason'));
  });

  it('keeps Tab inside it, both ways round', () => {
    render(<Opener />);
    fireEvent.click(screen.getByText('Open'));
    const cancel = screen.getByText('Cancel');
    const block = screen.getByText('Block');

    block.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(block);
  });

  it('gives focus back to what opened it when it closes', () => {
    render(<Opener />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Block this number?')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('a drawer does the same', () => {
    render(
      <Drawer title="Lead" onClose={() => undefined} footer={<button>Save</button>}>
        <textarea aria-label="Note" />
      </Drawer>
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Note'));
  });
});
