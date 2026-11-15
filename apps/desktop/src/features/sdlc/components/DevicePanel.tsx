import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/primitives/input';
import { Select } from '@/shared/ui/primitives/select';
import { BumaLoading } from '@/shared/ui/buma/Loading';
import {
  deviceBoot,
  deviceFrame,
  deviceKey,
  deviceOverview,
  deviceSaveShot,
  deviceSwipe,
  deviceTap,
  deviceText,
  type DeviceFrame,
  type DeviceOverview,
} from '@/features/sdlc/lib/device';

/** How long to wait after a picture before asking for the next one. */
const FRAME_GAP_MS = 250;
/** How often the list of devices is read again while none is ready. */
const OVERVIEW_MS = 2500;
/** A press that moves less than this (in pixels on screen) is a tap. */
const TAP_SLOP = 10;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/**
 * The Android emulator (or a phone on USB) in the app: its screen as pictures that refresh a few times a
 * second, taps and swipes on it go to the device, and buttons for Back, Home, typing and a screenshot
 * saved in the feature for the Verify stage.
 */
export function DevicePanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<DeviceOverview | null>(null);
  const [serial, setSerial] = useState<string | null>(null);
  const [avd, setAvd] = useState('');
  const [starting, setStarting] = useState(false);
  const [frame, setFrame] = useState<DeviceFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const press = useRef<{ x: number; y: number; at: number } | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const refresh = useRef<() => void>(() => {});

  const ready = overview?.devices.filter((d) => d.state === 'device') ?? [];

  // The devices: read at once, and again every few seconds until one is ready (an emulator takes a while to boot).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      void deviceOverview()
        .then((o) => {
          if (!alive) return;
          setOverview(o);
          setAvd((a) => a || o.avds[0] || '');
          const ok = o.devices.filter((d) => d.state === 'device');
          setSerial((s) => (s && ok.some((d) => d.serial === s) ? s : (ok[0]?.serial ?? null)));
          if (ok.length) setStarting(false);
          if (!ok.length) timer = setTimeout(load, OVERVIEW_MS);
        })
        .catch((e) => alive && (setError(message(e)), setOverview({ sdk: false, devices: [], avds: [] })));
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [starting]);

  // The screen: one picture, a short wait, the next.
  useEffect(() => {
    if (!serial) {
      setFrame(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      clearTimeout(timer);
      void deviceFrame(serial)
        .then((f) => {
          if (!alive) return;
          setFrame(f);
          setError(null);
          timer = setTimeout(next, FRAME_GAP_MS);
        })
        .catch((e) => {
          if (!alive) return;
          setError(message(e));
          timer = setTimeout(next, 2000);
        });
    };
    refresh.current = next;
    next();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [serial]);

  /** Does something on the device, then shows the result without waiting for the next picture. */
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        setError(null);
        await fn();
        setTimeout(() => refresh.current(), 150);
      } catch (e) {
        setError(message(e));
      }
    },
    [],
  );

  const toDevice = (e: PointerEvent) => {
    const r = img.current!.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * frame!.width),
      y: Math.round(((e.clientY - r.top) / r.height) * frame!.height),
    };
  };
  const onUp = (e: PointerEvent) => {
    const start = press.current;
    press.current = null;
    if (!start || !serial || !frame) return;
    const from = toDevice({ clientX: start.x, clientY: start.y } as PointerEvent);
    const to = toDevice(e);
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved < TAP_SLOP) void act(() => deviceTap(serial, to.x, to.y));
    else void act(() => deviceSwipe(serial, from.x, from.y, to.x, to.y, Math.min(Math.max(Date.now() - start.at, 80), 1500)));
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await deviceBoot(avd);
    } catch (e) {
      setStarting(false);
      setError(message(e));
    }
  };

  const type = (e: FormEvent) => {
    e.preventDefault();
    if (!serial || !typed) return;
    void act(() => deviceText(serial, typed)).then(() => setTyped(''));
  };

  const save = () =>
    serial &&
    void act(async () => {
      setNote(t('device.saved', { path: await deviceSaveShot(projectId, serial) }));
    });

  if (!overview) {
    return (
      <div className="flex justify-center p-6">
        <BumaLoading variant="process" labelText={t('device.loading')} />
      </div>
    );
  }
  if (!overview.sdk) {
    return <p className="m-0 text-[13px] text-text-2">{t('device.noSdk')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {ready.length > 1 && (
        <Select size="sm" aria-label={t('device.pick')} value={serial ?? ''} onChange={(e) => setSerial(e.target.value)}>
          {ready.map((d) => (
            <option key={d.serial} value={d.serial}>
              {d.name}
            </option>
          ))}
        </Select>
      )}
      {ready.length === 0 && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[13px] text-text-2">{overview.avds.length ? t('device.noneRunning') : t('device.noAvd')}</p>
          {overview.devices.some((d) => d.state === 'unauthorized') && <p className="m-0 text-xs text-text-3">{t('device.unauthorized')}</p>}
          {overview.avds.length > 0 && (
            <div className="flex items-center gap-2">
              <Select size="sm" className="flex-1" aria-label={t('device.emulator')} value={avd} onChange={(e) => setAvd(e.target.value)} disabled={starting}>
                {overview.avds.map((a) => (
                  <option key={a} value={a}>
                    {a.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
              <Button small disabled={starting || !avd} onClick={() => void start()}>
                {starting ? t('device.starting') : t('device.start')}
              </Button>
            </div>
          )}
          {starting && <BumaLoading variant="process" labelText={t('device.booting')} />}
        </div>
      )}

      {serial && (
        <>
          {frame ? (
            <img
              ref={img}
              src={`data:image/png;base64,${frame.png}`}
              alt={t('device.screen')}
              draggable={false}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                press.current = { x: e.clientX, y: e.clientY, at: Date.now() };
              }}
              onPointerUp={onUp}
              className="mx-auto max-h-[60vh] w-auto max-w-full cursor-pointer touch-none rounded-[20px] border border-border bg-black select-none"
            />
          ) : (
            <div className="flex justify-center p-6">
              <BumaLoading variant="process" labelText={t('device.connecting')} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button small variant="secondary" onClick={() => void act(() => deviceKey(serial, 'back'))}>
              {t('device.back')}
            </Button>
            <Button small variant="secondary" onClick={() => void act(() => deviceKey(serial, 'home'))}>
              {t('device.home')}
            </Button>
            <Button small variant="secondary" onClick={() => void act(() => deviceKey(serial, 'recents'))}>
              {t('device.recents')}
            </Button>
            <Button small className="ml-auto" onClick={save}>
              {t('device.screenshot')}
            </Button>
          </div>
          <form onSubmit={type} className="flex items-center gap-2">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('device.typePlaceholder')} aria-label={t('device.type')} maxLength={500} />
            <Button small type="submit" variant="secondary" disabled={!typed}>
              {t('device.send')}
            </Button>
          </form>
        </>
      )}
      {note && (
        <p role="status" className="m-0 text-xs text-text-3">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-error">
          {error}
        </p>
      )}
    </div>
  );
}
