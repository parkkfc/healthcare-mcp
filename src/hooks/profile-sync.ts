/** Cross-widget signal so open-home reloads get-user after settings saves. */
const CHANNEL = "hands-on-diet-profile";

export function bumpProfile() {
  try {
    localStorage.setItem(CHANNEL, String(Date.now()));
  } catch {
    /* private mode / blocked storage */
  }
  try {
    const bus = new BroadcastChannel(CHANNEL);
    bus.postMessage({ t: Date.now() });
    bus.close();
  } catch {
    /* unsupported */
  }
}

export function onProfileBump(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CHANNEL) callback();
  };
  window.addEventListener("storage", onStorage);

  let bus: BroadcastChannel | null = null;
  try {
    bus = new BroadcastChannel(CHANNEL);
    bus.onmessage = () => callback();
  } catch {
    bus = null;
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    bus?.close();
  };
}
