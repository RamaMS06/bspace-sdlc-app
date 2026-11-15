import { invoke } from '@tauri-apps/api/core';

export interface Device {
  serial: string;
  name: string;
  /** `device` is ready; `offline` or `unauthorized` can't be driven yet. */
  state: string;
  emulator: boolean;
}

export interface DeviceOverview {
  sdk: boolean;
  devices: Device[];
  avds: string[];
}

export interface DeviceFrame {
  /** The screen as a PNG, base64. */
  png: string;
  width: number;
  height: number;
}

export const deviceOverview = () => invoke<DeviceOverview>('device_overview');
export const deviceBoot = (avd: string) => invoke<void>('device_boot', { avd });
export const deviceFrame = (serial: string) => invoke<DeviceFrame>('device_frame', { serial });
export const deviceTap = (serial: string, x: number, y: number) => invoke<void>('device_tap', { serial, x, y });
export const deviceSwipe = (serial: string, x1: number, y1: number, x2: number, y2: number, ms: number) =>
  invoke<void>('device_swipe', { serial, x1, y1, x2, y2, ms });
export const deviceKey = (serial: string, name: 'home' | 'back' | 'recents' | 'enter' | 'delete') => invoke<void>('device_key', { serial, name });
export const deviceText = (serial: string, text: string) => invoke<void>('device_text', { serial, text });
export const deviceSaveShot = (projectId: string, serial: string) => invoke<string>('device_save_shot', { projectId, serial });
