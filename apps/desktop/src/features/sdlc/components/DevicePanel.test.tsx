import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('@/features/sdlc/lib/device', () => ({
  deviceOverview: vi.fn(),
  deviceBoot: vi.fn(),
  deviceFrame: vi.fn(),
  deviceTap: vi.fn(),
  deviceSwipe: vi.fn(),
  deviceKey: vi.fn(),
  deviceText: vi.fn(),
  deviceSaveShot: vi.fn(),
}));

import * as dev from '@/features/sdlc/lib/device';
import { DevicePanel } from '@/features/sdlc/components/DevicePanel';
import '@/i18n';

const phone = { serial: 'emulator-5554', name: 'Pixel 8', state: 'device', emulator: true };
const frame = { png: 'AAAA', width: 1080, height: 2400 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(dev.deviceFrame).mockResolvedValue(frame);
  vi.mocked(dev.deviceTap).mockResolvedValue();
  vi.mocked(dev.deviceSwipe).mockResolvedValue();
  vi.mocked(dev.deviceKey).mockResolvedValue();
  vi.mocked(dev.deviceText).mockResolvedValue();
});

/** The screen is 540x1200 on the page, so a point is half its device pixel. */
function screenAt(img: HTMLElement) {
  img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 540, height: 1200, right: 540, bottom: 1200, x: 0, y: 0, toJSON: () => ({}) });
  img.setPointerCapture = vi.fn();
}

describe('DevicePanel', () => {
  it('says what to install when there is no Android SDK', async () => {
    vi.mocked(dev.deviceOverview).mockResolvedValue({ sdk: false, devices: [], avds: [] });
    render(<DevicePanel projectId="p1" />);
    expect(await screen.findByText(/Android SDK isn't installed/)).toBeInTheDocument();
    expect(dev.deviceFrame).not.toHaveBeenCalled();
  });

  it('offers to start an emulator when none is running, and starts the picked one', async () => {
    vi.mocked(dev.deviceOverview).mockResolvedValue({ sdk: true, devices: [], avds: ['Pixel_8_API_35', 'Tablet'] });
    vi.mocked(dev.deviceBoot).mockResolvedValue();
    render(<DevicePanel projectId="p1" />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Emulator' }), 'Tablet');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(dev.deviceBoot).toHaveBeenCalledWith('Tablet');
    expect(await screen.findByText(/emulator is starting/)).toBeInTheDocument();
  });

  it('shows the screen, and a tap lands on the matching device pixel', async () => {
    vi.mocked(dev.deviceOverview).mockResolvedValue({ sdk: true, devices: [phone], avds: [] });
    render(<DevicePanel projectId="p1" />);
    const img = await screen.findByRole('img', { name: 'Device screen' });
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    screenAt(img);
    fireEvent.pointerDown(img, { clientX: 270, clientY: 600, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 272, clientY: 601, pointerId: 1 });
    await waitFor(() => expect(dev.deviceTap).toHaveBeenCalledWith('emulator-5554', 544, 1202));
    expect(dev.deviceSwipe).not.toHaveBeenCalled();
  });

  it('a drag is a swipe from where it began to where it ended', async () => {
    vi.mocked(dev.deviceOverview).mockResolvedValue({ sdk: true, devices: [phone], avds: [] });
    render(<DevicePanel projectId="p1" />);
    const img = await screen.findByRole('img', { name: 'Device screen' });
    screenAt(img);
    fireEvent.pointerDown(img, { clientX: 270, clientY: 900, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 270, clientY: 300, pointerId: 1 });
    await waitFor(() => expect(dev.deviceSwipe).toHaveBeenCalled());
    expect(vi.mocked(dev.deviceSwipe).mock.calls[0]!.slice(0, 5)).toEqual(['emulator-5554', 540, 1800, 540, 600]);
    expect(dev.deviceTap).not.toHaveBeenCalled();
  });

  it('Back, Home, typing and a screenshot go to the device', async () => {
    vi.mocked(dev.deviceOverview).mockResolvedValue({ sdk: true, devices: [phone], avds: [] });
    vi.mocked(dev.deviceSaveShot).mockResolvedValue('device-shots/device-1.png');
    render(<DevicePanel projectId="p1" />);
    await screen.findByRole('img', { name: 'Device screen' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(vi.mocked(dev.deviceKey).mock.calls.map((c) => c[1])).toEqual(['back', 'home']);
    await userEvent.type(screen.getByRole('textbox', { name: 'Type on the device' }), 'halo');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(dev.deviceText).toHaveBeenCalledWith('emulator-5554', 'halo');
    await userEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved in device-shots/device-1.png');
    expect(dev.deviceSaveShot).toHaveBeenCalledWith('p1', 'emulator-5554');
  });

  it("shows the device's own words when it refuses", async () => {
    vi.mocked(dev.deviceOverview).mockResolvedValue({ sdk: true, devices: [phone], avds: [] });
    vi.mocked(dev.deviceKey).mockRejectedValue('device offline');
    render(<DevicePanel projectId="p1" />);
    await screen.findByRole('img', { name: 'Device screen' });
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Home' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('device offline');
  });
});
