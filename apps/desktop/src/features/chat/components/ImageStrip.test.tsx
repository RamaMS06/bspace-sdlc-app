import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { ChatMessage, MessagePart } from '@bspace-sdlc-app/shared';

vi.mock('@/shared/lib/ipc', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(null),
  agentStart: vi.fn().mockResolvedValue(undefined),
  agentPrompt: vi.fn().mockResolvedValue(undefined),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  assetUrl: (p: string) => `asset://${p}`,
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn().mockResolvedValue(undefined) }));

import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { MessageList } from '@/features/chat/components/MessageList';
import { setUiLanguage } from '@/i18n';
import { useChat } from '@/features/chat/state/chat';

describe('the image strip', () => {
  const user: ChatMessage = { id: 'u', chatId: 'c1', role: 'user', parts: [{ type: 'text', text: 'go' }], createdAt: '' };
  const part = (i: number): MessagePart => ({ type: 'file', path: `/w/p1/art/s${i}.png`, name: `s${i}.png`, mime: 'image/png', size: 5, modifiedAt: `2026-11-04T10:00:0${i % 10}.000Z` });
  const agent = (n: number): ChatMessage => ({
    id: 'a', chatId: 'c1', role: 'agent', createdAt: '',
    parts: [{ type: 'text', text: 'Here they are' }, ...Array.from({ length: n }, (_, i) => part(i + 1))],
  });
  beforeEach(() => useChat.getState().reset());

  it('shows 96 px lazy thumbnails after the text, 8 at most, then +N more', async () => {
    render(<MessageList messages={[user, agent(10)]} streaming={false} />);
    const strip = screen.getByRole('group', { name: 'Images the agent made' });
    const thumbs = within(strip).getAllByRole('img');
    expect(thumbs).toHaveLength(8);
    expect(thumbs[0]).toHaveAttribute('src', `asset:///w/p1/art/s1.png?v=${encodeURIComponent('2026-11-04T10:00:01.000Z')}`);
    expect(thumbs[0]).toHaveAttribute('alt', 's1.png');
    expect(thumbs[0]).toHaveAttribute('loading', 'lazy');
    expect(thumbs[0]).toHaveAttribute('decoding', 'async');
    expect(thumbs[0]!.className).toContain('h-24');
    // Order: the words first, then the strip.
    const text = screen.getByText('Here they are');
    expect(text.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(within(strip).getByRole('button', { name: '+2 more' }));
    expect(within(strip).getAllByRole('img')).toHaveLength(10);
  });

  it('opens a lightbox that steps through the message and closes back to the thumbnail', async () => {
    render(<MessageList messages={[user, agent(3)]} streaming={false} />);
    const first = screen.getByRole('button', { name: 'Open image s1.png' });
    await userEvent.click(first);
    const dialog = await screen.findByRole('dialog', { name: 's1.png' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next image' }));
    expect(screen.getByRole('dialog', { name: 's2.png' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 's3.png' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 's1.png' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog', { name: 's3.png' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous image' }));
    expect(screen.getByRole('dialog', { name: 's2.png' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open in folder' }));
    expect(revealItemInDir).toHaveBeenCalledWith('/w/p1/art/s2.png');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(first).toHaveFocus();
  });

  it('tries once more, then shows a muted tile, never a broken image, when the file is gone', () => {
    render(<MessageList messages={[user, agent(2)]} streaming={false} />);
    const strip = screen.getByRole('group', { name: 'Images the agent made' });
    // A file still being written can fail once: it is read again before giving up.
    fireEvent.error(within(strip).getAllByRole('img')[0]!);
    expect(within(strip).getAllByRole('img')[0]!.getAttribute('src')).toMatch(/[?&]r=1$/);
    expect(within(strip).queryByText('Image no longer available')).toBeNull();
    fireEvent.error(within(strip).getAllByRole('img')[0]!);
    expect(within(strip).getByText('Image no longer available')).toBeInTheDocument();
    expect(within(strip).getAllByRole('img')).toHaveLength(1);
  });

  it('returns focus to the thumbnail after a mouse click opened the lightbox', async () => {
    render(<MessageList messages={[user, agent(2)]} streaming={false} />);
    const second = screen.getByRole('button', { name: 'Open image s2.png' });
    // WebKit does not focus a button on a mouse click.
    fireEvent.click(second);
    expect(second).not.toHaveFocus();
    await screen.findByRole('dialog', { name: 's2.png' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(second).toHaveFocus();
  });

  it('steps from a missing image straight to the next one', async () => {
    render(<MessageList messages={[user, agent(2)]} streaming={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open image s1.png' }));
    const dialog = await screen.findByRole('dialog', { name: 's1.png' });
    fireEvent.error(within(dialog).getByRole('img'));
    fireEvent.error(within(dialog).getByRole('img'));
    expect(within(dialog).getByText('Image no longer available')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next image' }));
    const next = screen.getByRole('dialog', { name: 's2.png' });
    expect(within(next).queryByText('Image no longer available')).toBeNull();
    expect(within(next).getByRole('img')).toHaveAttribute('alt', 's2.png');
  });

  it('reads in Indonesian', async () => {
    setUiLanguage('id');
    render(<MessageList messages={[user, agent(9)]} streaming={false} />);
    expect(screen.getByRole('group', { name: 'Gambar buatan agen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+1 lagi' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Buka gambar s1.png' }));
    expect(await screen.findByRole('button', { name: 'Gambar berikutnya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buka di folder' })).toBeInTheDocument();
  });
});
