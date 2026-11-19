import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { AlarmClock, BookOpen, Info, Maximize, Moon, Plus, Trash2, Volume2 } from 'lucide-react';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Each alarm gets its own color so you can see at a glance which days belong to it.
// The first alarm keeps Remala's original yellow.
const COLORS = [
  { name: 'Yellow', hex: '#eca13b' },
  { name: 'Blue', hex: '#62a8e5' },
  { name: 'Purple', hex: '#a98ae4' },
  { name: 'Green', hex: '#6cc28a' },
  { name: 'Red', hex: '#e8706a' },
  { name: 'Pink', hex: '#e687b8' },
  { name: 'Teal', hex: '#4fc1b9' },
];
const MAX_ALARMS = COLORS.length;

type Alarm = { id: string; time: string; days: boolean[]; color: number };

// ---------- Saving to this browser ----------
// Everything is kept in localStorage, so closing the tab (or the whole browser)
// and coming back keeps your alarms exactly as you left them.
const ALARMS_KEY = 'remala-alarms';
const ARMED_KEY = 'remala-armed';

const newId = () => Math.random().toString(36).slice(2, 9);
const defaultAlarms = (): Alarm[] => [{ id: newId(), time: '07:30', days: Array(7).fill(true), color: 0 }];

const loadAlarms = (): Alarm[] => {
  try {
    const raw = localStorage.getItem(ALARMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Alarm[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    // Bring over settings saved by the first version of Remala.
    const oldTime = localStorage.getItem('remala-time');
    const oldDays = localStorage.getItem('remala-days');
    if (oldTime) return [{ id: newId(), time: oldTime, days: oldDays ? (JSON.parse(oldDays) as boolean[]) : Array(7).fill(true), color: 0 }];
  } catch { /* fall through to the default */ }
  return defaultAlarms();
};

// Saved the moment the alarm starts, so a reload brings it back armed.
type ArmedState = { armedAt: number; fired: string[]; ringing: boolean };
const loadArmed = (): ArmedState | null => {
  try {
    const raw = localStorage.getItem(ARMED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ArmedState;
    return { armedAt: parsed.armedAt, fired: Array.isArray(parsed.fired) ? parsed.fired : [], ringing: parsed.ringing };
  } catch { return null; }
};
const saveArmed = (state: ArmedState | null) => {
  try {
    if (state) localStorage.setItem(ARMED_KEY, JSON.stringify(state));
    else localStorage.removeItem(ARMED_KEY);
  } catch { /* storage can be unavailable in private windows */ }
};

// ---------- Time helpers ----------
const parseTime = (time: string) => time.split(':').map(Number) as [number, number];
const formatTime = (time: string) => {
  const [hours, minutes] = parseTime(time);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const dayText = (days: boolean[]) => {
  if (days.every(Boolean)) return 'Every day';
  if (days.every((on, index) => on === (index > 0 && index < 6))) return 'Weekdays';
  if (days.every((on, index) => on === (index === 0 || index === 6))) return 'Weekends';
  return DAY_LETTERS.filter((_, index) => days[index]).join(' · ') || 'No days picked yet';
};
const nextRing = (alarms: Alarm[]) => {
  let best: { date: Date; alarm: Alarm } | null = null;
  const now = Date.now();
  for (const alarm of alarms) {
    const [hours, minutes] = parseTime(alarm.time);
    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = new Date();
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hours, minutes, 0, 0);
      if (alarm.days[candidate.getDay()] && candidate.getTime() > now) {
        if (!best || candidate < best.date) best = { date: candidate, alarm };
        break;
      }
    }
  }
  return best;
};

// ---------- Sound ----------
// One alarm "beep-beep": two loud square-wave tones. Websites cannot raise the
// computer's own volume, so this plays as loud as the page is allowed to.
const ALARM_GAIN = 0.6;
const playBeep = (context: AudioContext) => {
  const start = context.currentTime;
  [0, 0.2].forEach((offset, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = index === 0 ? 880 : 1175;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(ALARM_GAIN, start + offset + 0.02);
    gain.gain.setValueAtTime(ALARM_GAIN, start + offset + 0.14);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.17);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.18);
  });
};

// ---------- Full screen (Safari still uses the webkit- names) ----------
type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
const isFullscreen = () => {
  const doc = document as FullscreenDoc;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
};
const enterFullscreen = () => {
  const element = document.documentElement as FullscreenEl;
  if (isFullscreen()) return;
  try {
    const result = element.requestFullscreen ? element.requestFullscreen() : element.webkitRequestFullscreen?.();
    if (result instanceof Promise) result.catch(() => undefined);
  } catch { /* full screen is optional; the alarm works without it */ }
};
const exitFullscreen = () => {
  const doc = document as FullscreenDoc;
  if (!isFullscreen()) return;
  try {
    const result = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
    if (result instanceof Promise) result.catch(() => undefined);
  } catch { /* ignore */ }
};

// ---------- One alarm card ----------
type CardProps = {
  alarm: Alarm;
  alarms: Alarm[];
  index: number;
  editing: boolean;
  onEdit: () => void;
  onSaveTime: (time: string) => void;
  onToggleDay: (day: number) => void;
  onRemove: (() => void) | null;
};

function AlarmCard({ alarm, alarms, index, editing, onEdit, onSaveTime, onToggleDay, onRemove }: CardProps) {
  const color = COLORS[alarm.color] ?? COLORS[0];
  const [draft, setDraft] = useState({ hour: 7, minute: 30, pm: false });
  const multiple = alarms.length > 1;

  const openEditor = () => {
    const [hours24, minutes] = parseTime(alarm.time);
    setDraft({ hour: hours24 % 12 === 0 ? 12 : hours24 % 12, minute: minutes, pm: hours24 >= 12 });
    onEdit();
  };
  const save = () => {
    const hours24 = (draft.hour % 12) + (draft.pm ? 12 : 0);
    onSaveTime(`${String(hours24).padStart(2, '0')}:${String(draft.minute).padStart(2, '0')}`);
  };

  return (
    <section className="alarm-panel" style={{ '--accent': color.hex } as CSSProperties} aria-label={multiple ? `Alarm ${index + 1}` : 'Alarm settings'} data-testid={`alarm-card-${index}`}>
      <div className="panel-top">
        <div className="panel-label"><AlarmClock size={14} strokeWidth={1.7} /><span>{multiple ? `Alarm ${index + 1} · wake up at` : 'Wake up at'}</span></div>
        {onRemove && (
          <button className="remove-alarm" type="button" onClick={onRemove} aria-label={`Delete alarm ${index + 1}`} data-testid={`button-remove-${index}`}>
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <div className="time-display" data-testid={`text-wake-time-${index}`}>{formatTime(alarm.time)}</div>
      {editing ? (
        <div className="time-editor" role="group" aria-label="Change wake-up time">
          <select className="time-select" aria-label="Hour" value={draft.hour} onChange={(event) => setDraft({ ...draft, hour: Number(event.target.value) })} data-testid={`select-hour-${index}`}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
          </select>
          <span className="time-colon">:</span>
          <select className="time-select" aria-label="Minute" value={draft.minute} onChange={(event) => setDraft({ ...draft, minute: Number(event.target.value) })} data-testid={`select-minute-${index}`}>
            {Array.from({ length: 60 }, (_, i) => i).map((minute) => <option key={minute} value={minute}>{String(minute).padStart(2, '0')}</option>)}
          </select>
          <select className="time-select" aria-label="AM or PM" value={draft.pm ? 'PM' : 'AM'} onChange={(event) => setDraft({ ...draft, pm: event.target.value === 'PM' })} data-testid={`select-ampm-${index}`}>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
          <button className="save-time" type="button" onClick={save} data-testid={`button-save-time-${index}`}>Save time</button>
        </div>
      ) : (
        <div className="change-row">
          <button className="change-time" type="button" onClick={openEditor} data-testid={`button-change-time-${index}`}>Change time</button>
        </div>
      )}
      <div className="week-label">Repeat on</div>
      <div className="weekdays" role="group" aria-label="Choose repeat days">
        {DAY_LETTERS.map((letter, day) => {
          const owner = alarms.find((other) => other.days[day]);
          const mine = alarm.days[day];
          const takenBy = !mine && owner ? owner : null;
          const ownerIndex = takenBy ? alarms.indexOf(takenBy) : -1;
          return (
            <button
              key={`${letter}-${day}`}
              type="button"
              className={`day-button${takenBy ? ' taken' : ''}`}
              style={takenBy ? ({ '--other': (COLORS[takenBy.color] ?? COLORS[0]).hex } as CSSProperties) : undefined}
              aria-label={takenBy ? `${DAY_NAMES[day]}, used by alarm ${ownerIndex + 1}. Tap to move it here.` : DAY_NAMES[day]}
              aria-pressed={mine}
              title={takenBy ? `Used by alarm ${ownerIndex + 1}. Tap to move it here.` : undefined}
              data-testid={`button-day-${index}-${day}`}
              onClick={() => onToggleDay(day)}
            >{letter}</button>
          );
        })}
      </div>
      <div className="schedule-summary" data-testid={`text-repeat-summary-${index}`}>{dayText(alarm.days)}</div>
    </section>
  );
}

// ---------- The app ----------
export default function App() {
  const [restored] = useState(loadArmed);
  const [alarms, setAlarms] = useState<Alarm[]>(loadAlarms);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<'setup' | 'night' | 'ringing'>(() => restored ? (restored.ringing ? 'ringing' : 'night') : 'setup');
  const [revealed, setRevealed] = useState(() => restored?.ringing ?? false);
  // After a reload the browser blocks sound (and full screen) until the user clicks once.
  const [needsTap, setNeedsTap] = useState(() => restored !== null);
  const [testing, setTesting] = useState(false);
  const [fullscreen, setFullscreen] = useState(isFullscreen);
  const [wakeStatus, setWakeStatus] = useState<'idle' | 'active' | 'unsupported' | 'denied'>('idle');
  const [clockNow, setClockNow] = useState(() => new Date());
  const audioRef = useRef<AudioContext | null>(null);
  const toneRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const firedRef = useRef<string[]>(restored?.fired ?? []);
  const armedAtRef = useRef(restored?.armedAt ?? 0);
  const hideTimerRef = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const alarmsRef = useRef(alarms);
  alarmsRef.current = alarms;

  // Save alarms to this browser whenever they change.
  useEffect(() => {
    try { localStorage.setItem(ALARMS_KEY, JSON.stringify(alarms)); } catch { /* private window */ }
  }, [alarms]);

  // Save the armed alarm every time the mode changes.
  useEffect(() => {
    if (mode === 'setup') saveArmed(null);
    else saveArmed({ armedAt: armedAtRef.current, fired: firedRef.current, ringing: mode === 'ringing' });
  }, [mode]);

  // Ask "Leave site?" before a reload, Cmd+W, or closing the window while the alarm is on.
  useEffect(() => {
    if (mode === 'setup') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [mode]);

  useEffect(() => {
    const onChange = () => setFullscreen(isFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const ensureAudio = useCallback(() => {
    try {
      if (!audioRef.current && window.AudioContext) audioRef.current = new window.AudioContext();
      const context = audioRef.current;
      if (context && context.state !== 'running') {
        void context.resume().then(() => setNeedsTap(context.state !== 'running')).catch(() => setNeedsTap(true));
      }
      return context;
    } catch { return null; }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) {
      setWakeStatus('unsupported');
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      setWakeStatus('active');
      wakeLockRef.current.addEventListener('release', () => {
        if (modeRef.current !== 'setup') setWakeStatus('idle');
      });
    } catch {
      setWakeStatus('denied');
    }
  }, []);

  const stopSound = useCallback(() => {
    if (toneRef.current !== null) window.clearInterval(toneRef.current);
    toneRef.current = null;
  }, []);

  const beginSound = useCallback(() => {
    const context = ensureAudio();
    if (!context) return;
    const ring = () => {
      if (context.state !== 'running') {
        void context.resume().catch(() => undefined);
        return;
      }
      playBeep(context);
    };
    ring();
    if (toneRef.current !== null) window.clearInterval(toneRef.current);
    toneRef.current = window.setInterval(ring, 900);
  }, [ensureAudio]);

  const testSound = () => {
    const context = ensureAudio();
    if (!context || testing) return;
    setTesting(true);
    let count = 0;
    const play = () => {
      if (context.state === 'running') playBeep(context);
      count += 1;
      if (count < 3) window.setTimeout(play, 900);
      else window.setTimeout(() => setTesting(false), 500);
    };
    void context.resume().catch(() => undefined).finally(play);
  };

  // Ring when any alarm's time arrives on one of its days. An alarm whose time had
  // already passed when you pressed Start alarm waits for its next day.
  const schedule = useCallback(() => {
    const now = new Date();
    for (const alarm of alarmsRef.current) {
      if (!alarm.days[now.getDay()]) continue;
      const [hours, minutes] = parseTime(alarm.time);
      const due = new Date(now);
      due.setHours(hours, minutes, 0, 0);
      if (due.getTime() > now.getTime() || due.getTime() < armedAtRef.current) continue;
      const key = `${alarm.id}-${due.toDateString()}-${alarm.time}`;
      if (firedRef.current.includes(key)) continue;
      firedRef.current = [...firedRef.current.slice(-20), key];
      setMode('ringing');
      beginSound();
      setRevealed(true);
      return;
    }
  }, [beginSound]);

  // Coming back after a reload: re-arm the wake lock, and keep ringing if it was ringing.
  useEffect(() => {
    if (!restored) return;
    void acquireWakeLock();
    if (restored.ringing) beginSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tick = () => {
      setClockNow(new Date());
      if (modeRef.current !== 'setup') schedule();
    };
    const timer = window.setInterval(tick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick();
        if (modeRef.current === 'ringing') beginSound();
        if (modeRef.current !== 'setup' && wakeLockRef.current?.released) void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [acquireWakeLock, beginSound, schedule]);

  useEffect(() => () => {
    stopSound();
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    void wakeLockRef.current?.release();
  }, [stopSound]);

  const requestReveal = useCallback(() => {
    if (modeRef.current !== 'night') return;
    setRevealed(true);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setRevealed(false), 10000);
  }, []);

  // A bumped keyboard also just shows the alarm for a moment.
  useEffect(() => {
    if (mode !== 'night') return;
    const onKey = () => requestReveal();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, requestReveal]);

  // ---------- Editing alarms ----------
  const toggleDay = (alarmId: string, day: number) => {
    setAlarms((previous) => {
      const owner = previous.find((alarm) => alarm.days[day]);
      return previous.map((alarm) => {
        if (alarm.id === alarmId) {
          const days = [...alarm.days];
          days[day] = !days[day];
          return { ...alarm, days };
        }
        // Each day belongs to one alarm, so tapping a day moves it off the other alarm.
        if (owner && alarm.id === owner.id) {
          const days = [...alarm.days];
          days[day] = false;
          return { ...alarm, days };
        }
        return alarm;
      });
    });
  };
  const saveTime = (alarmId: string, time: string) => {
    setAlarms((previous) => previous.map((alarm) => alarm.id === alarmId ? { ...alarm, time } : alarm));
    setEditingId(null);
  };
  const addAlarm = () => {
    if (alarms.length >= MAX_ALARMS) return;
    const used = new Set(alarms.map((alarm) => alarm.color));
    const color = COLORS.findIndex((_, index) => !used.has(index));
    const alarm: Alarm = { id: newId(), time: alarms[alarms.length - 1]?.time ?? '07:30', days: Array(7).fill(false), color: color === -1 ? 0 : color };
    setAlarms((previous) => [...previous, alarm]);
    setEditingId(null);
  };
  const removeAlarm = (alarmId: string) => {
    setAlarms((previous) => previous.length > 1 ? previous.filter((alarm) => alarm.id !== alarmId) : previous);
    if (editingId === alarmId) setEditingId(null);
  };

  // ---------- Alarm on / off ----------
  const anyDays = alarms.some((alarm) => alarm.days.some(Boolean));
  const startAlarm = async () => {
    if (!anyDays) return;
    enterFullscreen(); // must run first, while the click still counts as a user action
    armedAtRef.current = Date.now();
    firedRef.current = [];
    setEditingId(null);
    setMode('night');
    setRevealed(false);
    setNeedsTap(false);
    ensureAudio();
    await acquireWakeLock();
    schedule();
  };
  const reenableSound = () => {
    enterFullscreen();
    const context = ensureAudio();
    if (context) void context.resume().then(() => setNeedsTap(context.state !== 'running')).catch(() => undefined);
    else setNeedsTap(false);
    if (!wakeLockRef.current || wakeLockRef.current.released) void acquireWakeLock();
  };
  const turnOffAlarm = () => {
    stopSound();
    setMode('setup');
    setRevealed(false);
    setNeedsTap(false);
    setWakeStatus('idle');
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
    exitFullscreen();
  };
  const acknowledge = () => {
    stopSound();
    setMode('night');
    setRevealed(false);
  };

  const upcoming = nextRing(alarms);
  const upcomingDay = upcoming ? upcoming.date.toLocaleDateString([], { weekday: 'long' }) : '';
  const upcomingTime = upcoming ? formatTime(upcoming.alarm.time) : '';
  const ringTime = clockNow.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (mode !== 'setup') {
    return (
      <main className={`night-screen ${mode === 'ringing' ? 'ringing' : ''}`} data-testid="status-alarm-mode">
        {needsTap && (
          <button className="restore-banner" data-testid="button-reenable-sound" onClick={(event) => { event.stopPropagation(); reenableSound(); }}>
            <Volume2 size={18} strokeWidth={1.8} />
            <span>The page reloaded, but your alarm is still on. <b>Click here once to turn the sound back on.</b></span>
          </button>
        )}
        {mode === 'night' && !revealed ? (
          <button className="night-hidden" aria-label="Show alarm controls" data-testid="button-reveal-controls" onClick={requestReveal} />
        ) : (
          <div className="night-controls" onClick={mode === 'night' ? requestReveal : undefined}>
            <div className="night-brand"><b>Remala</b> remote alarm</div>
            <div className="status-pill" data-testid="status-wake-lock"><span className="status-dot" />{wakeStatus === 'active' ? 'ALARM ON · SCREEN AWAKE' : wakeStatus === 'unsupported' ? 'ALARM ON · KEEP-AWAKE UNSUPPORTED' : wakeStatus === 'denied' ? 'ALARM ON · KEEP-AWAKE BLOCKED' : 'ALARM ON'}</div>
            {mode === 'ringing' ? (
              <div className="ringing-content">
                <div className="good-morning">GOOD MORNING</div>
                <div className="ring-time" data-testid="text-ringing-time">{ringTime}</div>
                <button className="up-button" onClick={(event) => { event.stopPropagation(); acknowledge(); }} data-testid="button-im-up">I&rsquo;m up</button>
                <p className="ring-message">Your alarm stays on for its next morning.</p>
              </div>
            ) : (
              <>
                <div className="armed-label">Alarm on &middot; next ring</div>
                <div className="armed-time" data-testid="text-armed-time">{upcomingTime}</div>
                <div className="armed-days">{upcomingDay}{alarms.length > 1 ? ` · ${alarms.length} alarms set` : ` · ${dayText(alarms[0].days)}`}</div>
                <div className="night-actions">
                  <button className="return-button" onClick={(event) => { event.stopPropagation(); setRevealed(false); if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current); }} data-testid="button-back-to-dark">Back to dark screen</button>
                  {!fullscreen && (
                    <button className="cancel-button" onClick={(event) => { event.stopPropagation(); enterFullscreen(); }} data-testid="button-fullscreen"><Maximize size={13} strokeWidth={2} /> Full screen</button>
                  )}
                  <button className="cancel-button" onClick={(event) => { event.stopPropagation(); turnOffAlarm(); }} data-testid="button-turn-off-alarm">Turn off alarm</button>
                </div>
                <p className="night-footnote">This tab must stay open. Your laptop needs power and the lid open.</p>
              </>
            )}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="app-shell" data-testid="status-setup">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" />remala</div>
        <div className="top-note">A quieter way to wake</div>
      </header>
      <section className="setup-center">
        <div className="alarm-stack">
          {alarms.map((alarm, index) => (
            <AlarmCard
              key={alarm.id}
              alarm={alarm}
              alarms={alarms}
              index={index}
              editing={editingId === alarm.id}
              onEdit={() => setEditingId(alarm.id)}
              onSaveTime={(time) => saveTime(alarm.id, time)}
              onToggleDay={(day) => toggleDay(alarm.id, day)}
              onRemove={alarms.length > 1 ? () => removeAlarm(alarm.id) : null}
            />
          ))}
          {alarms.length < MAX_ALARMS && (
            <button className="add-alarm" type="button" onClick={addAlarm} data-testid="button-add-alarm">
              <Plus size={14} strokeWidth={2} /><span>{alarms.length === 1 ? 'Different time on some days? Add an alarm' : 'Add another alarm'}</span>
            </button>
          )}
          {alarms.length > 1 && <p className="multi-hint">Each day can have one alarm. Tap a day to move it to that alarm.</p>}
          <div className="start-panel">
            <p className="time-hint" data-testid="text-next-alarm">{upcoming ? <>Next alarm &middot; {upcomingDay} at {upcomingTime}</> : 'Pick at least one day to set your alarm'}</p>
            <button className="test-button" type="button" onClick={testSound} disabled={testing} data-testid="button-test-sound">
              <Volume2 size={15} strokeWidth={1.8} /><span>{testing ? 'Playing…' : 'Test sound'}</span>
            </button>
            <button className="start-button" type="button" onClick={startAlarm} disabled={!anyDays} data-testid="button-start-alarm">
              <Moon size={16} strokeWidth={2} /><span>Start alarm</span>
            </button>
            <p className="fine-print">Starting the alarm turns your screen black and fills it so you&rsquo;re not tempted by other tabs. Keep this tab open, your laptop plugged in, and the volume up.</p>
          </div>
        </div>
        <nav className="info-links">
          <a className="info-link" href="#protects" data-testid="link-protects"><Info size={14} strokeWidth={1.8} /><span>What Remala protects against</span></a>
          <a className="info-link" href="#research" data-testid="link-research"><BookOpen size={14} strokeWidth={1.8} /><span>Why Remala exists</span></a>
        </nav>
      </section>

      <section className="info-section" id="protects" aria-label="What Remala protects against">
        <h2>What Remala protects against</h2>
        <dl>
          <div><dt>An alarm that&rsquo;s too quiet</dt><dd>Remala rings with a loud two-tone beep at full strength. A website can&rsquo;t turn your computer&rsquo;s volume up for you, so press <b>Test sound</b> before bed. If you can&rsquo;t hear it clearly from your bed, turn your laptop volume up.</dd></div>
          <div><dt>Your laptop falling asleep</dt><dd>Once the alarm is on, Remala asks the browser to keep the screen awake, so the screen stays black instead of the laptop going to sleep. It can&rsquo;t beat a closed lid or a dead battery, so leave the lid open and the charger in.</dd></div>
          <div><dt>Stray clicks</dt><dd>Bumping the trackpad or keyboard only shows your alarm for 10 seconds. Nothing turns the alarm off except <b>I&rsquo;m up</b> or <b>Turn off alarm</b>.</dd></div>
          <div><dt>Accidental reloads</dt><dd>Your alarm is saved in this browser the moment you start it. If the page reloads, it comes back still on. Browsers block sound until you click a page once, so Remala will ask for one click to turn the sound back on.</dd></div>
          <div><dt>Closing the tab by accident</dt><dd>If you press &#8984;W, close the window, or try to leave while your alarm is on, your browser will ask if you&rsquo;re sure you want to leave.</dd></div>
          <div><dt>Forgetting your settings</dt><dd>Your alarms are saved in this browser. Close the tab or quit the browser, and they&rsquo;re still there when you come back. No account needed.</dd></div>
        </dl>
      </section>

      <section className="info-section research" id="research" aria-label="Why Remala exists">
        <h2>Why Remala exists</h2>
        <p className="research-intro">Most college students use their phone as their alarm, so the phone sleeps in their bed. Remala is a free way to move it out.</p>
        <div className="stat-grid">
          <div className="stat"><div className="stat-number">2.4&ndash;3.7&times;</div><p>higher odds of poor sleep for university students who use their phone more than 30 minutes with the lights off.</p><cite>Fallahmorad et al., 2026</cite></div>
          <div className="stat"><div className="stat-number">~70%</div><p>of college students get less than 8 hours of sleep, which is linked to lower GPAs and a higher risk of failing.</p><cite>Hershner &amp; Chervin, 2014</cite></div>
          <div className="stat"><div className="stat-number">56%</div><p>of Americans own a stand-alone alarm clock. Everyone else is likely waking up to a phone.</p><cite>Montgomery, YouGov, 2025</cite></div>
          <div className="stat"><div className="stat-number">93.6%</div><p>of adults who kept their phone out of the bedroom for a week said they would or might keep doing it.</p><cite>Hughes &amp; Burke, 2018</cite></div>
        </div>
        <dl>
          <div><dt>The alarm is why the phone stays in bed</dt><dd>Psychologist Jean Twenge found most students she interviewed kept their phone within reach overnight at least partly because it was their alarm clock. Using a phone in bed has also been linked to taking longer to fall asleep and a higher heart rate (Kheirinejad et al.).</dd></div>
          <div><dt>Why not just buy an alarm clock?</dt><dd>A basic alarm clock costs $10 to $15, and Loftie, a clock built to get phones out of bedrooms, costs $169. Any price above free is a real barrier when a phone alarm already &ldquo;does the job.&rdquo; Remala runs on the laptop you already own, so you can try it tonight.</dd></div>
        </dl>
        <details className="works-cited">
          <summary>Works cited</summary>
          <ul>
            <li>Fallahmorad, Zohreh, et al. &ldquo;Impact of Smartphone Use Duration before Bedtime on University Students&rsquo; Sleep Quality, Total and Concentration Performances, and Reaction Time.&rdquo; <i>Scientific Reports</i>, vol. 16, 2026, article 22149. <a href="https://doi.org/10.1038/s41598-026-42454-7" target="_blank" rel="noreferrer">doi.org/10.1038/s41598-026-42454-7</a></li>
            <li>Hershner, Shelley D., and Ronald D. Chervin. &ldquo;Causes and Consequences of Sleepiness among College Students.&rdquo; <i>Nature and Science of Sleep</i>, vol. 6, 2014, pp. 73&ndash;84. <a href="https://doi.org/10.2147/NSS.S62907" target="_blank" rel="noreferrer">doi.org/10.2147/NSS.S62907</a></li>
            <li>Hughes, Nicola, and Jolanta Burke. &ldquo;Sleeping with the Frenemy: How Restricting &lsquo;Bedroom Use&rsquo; of Smartphones Impacts Happiness and Wellbeing.&rdquo; <i>Computers in Human Behavior</i>, vol. 85, 2018, pp. 236&ndash;44. <a href="https://doi.org/10.1016/j.chb.2018.03.047" target="_blank" rel="noreferrer">doi.org/10.1016/j.chb.2018.03.047</a></li>
            <li>Kheirinejad, Saba, et al. &ldquo;&lsquo;Leave Your Smartphone out of Bed&rsquo;: Quantitative Analysis of Smartphone Use Effect on Sleep Quality.&rdquo; <i>Personal and Ubiquitous Computing</i>, vol. 27, 2023, pp. 447&ndash;66. <a href="https://doi.org/10.1007/s00779-022-01694-w" target="_blank" rel="noreferrer">doi.org/10.1007/s00779-022-01694-w</a></li>
            <li>Loftie. &ldquo;Loftie Clock.&rdquo; <a href="https://loftie.com/products/loftie" target="_blank" rel="noreferrer">loftie.com/products/loftie</a>. Accessed 7 Nov. 2026.</li>
            <li>Montgomery, David. &ldquo;Poll: Younger Americans Have a Harder Time Reading Clocks.&rdquo; <i>YouGov</i>, 29 Aug. 2025. <a href="https://yougov.com/en-us/articles/52878-younger-americans-hard-time-reading-clocks" target="_blank" rel="noreferrer">yougov.com</a></li>
            <li>Twenge, Jean. &ldquo;Analysis: Teens Are Sleeping Less. Why? Smartphones.&rdquo; <i>PBS NewsHour</i>, 19 Oct. 2017. <a href="https://www.pbs.org/newshour/science/analysis-teens-are-sleeping-less-why-smartphones" target="_blank" rel="noreferrer">pbs.org</a></li>
          </ul>
        </details>
      </section>
      <footer className="site-footer">Remala &middot; a free laptop alarm for students &middot; ENGW 1111 prototype</footer>
    </main>
  );
}
