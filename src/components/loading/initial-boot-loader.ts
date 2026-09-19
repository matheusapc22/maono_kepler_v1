export const INITIAL_BOOT_RUNTIME_TIMEOUT_MS = 35_000;

function browserWindow() {
  return typeof window === "undefined" ? null : (window as any);
}

function initialBootElement() {
  return typeof document === "undefined"
    ? null
    : document.getElementById("app-boot-fallback");
}

function clearReadinessTimeout(currentWindow: any) {
  if (
    currentWindow.__MAONO_BOOT_READINESS_TIMEOUT__ !== undefined &&
    currentWindow.__MAONO_BOOT_READINESS_TIMEOUT__ !== null
  ) {
    globalThis.clearTimeout(
      currentWindow.__MAONO_BOOT_READINESS_TIMEOUT__,
    );
    currentWindow.__MAONO_BOOT_READINESS_TIMEOUT__ = undefined;
  }
}

function clearInitialBootTimers(currentWindow: any) {
  if (
    currentWindow.__MAONO_BOOT_TIMEOUT__ !== undefined &&
    currentWindow.__MAONO_BOOT_TIMEOUT__ !== null
  ) {
    globalThis.clearTimeout(currentWindow.__MAONO_BOOT_TIMEOUT__);
    currentWindow.__MAONO_BOOT_TIMEOUT__ = undefined;
  }

  clearReadinessTimeout(currentWindow);
}

export function hasInitialBootLoader() {
  return initialBootElement() !== null;
}

export function acknowledgeInitialBootRuntime(
  timeoutMs = INITIAL_BOOT_RUNTIME_TIMEOUT_MS,
) {
  const currentWindow = browserWindow();

  if (!currentWindow) {
    return false;
  }

  if (
    currentWindow.__MAONO_BOOT_TIMEOUT__ !== undefined &&
    currentWindow.__MAONO_BOOT_TIMEOUT__ !== null
  ) {
    globalThis.clearTimeout(currentWindow.__MAONO_BOOT_TIMEOUT__);
    currentWindow.__MAONO_BOOT_TIMEOUT__ = undefined;
  }

  clearReadinessTimeout(currentWindow);

  const fallback = initialBootElement();

  if (
    !fallback ||
    fallback.dataset?.failed === "true" ||
    typeof currentWindow.__MAONO_SHOW_BOOT_FAILURE__ !== "function"
  ) {
    return false;
  }

  currentWindow.__MAONO_BOOT_READINESS_TIMEOUT__ =
    globalThis.setTimeout(() => {
      currentWindow.__MAONO_BOOT_READINESS_TIMEOUT__ = undefined;
      currentWindow.__MAONO_SHOW_BOOT_FAILURE__();
    }, Math.max(1, timeoutMs));

  return true;
}

export function completeInitialBootLoader() {
  const currentWindow = browserWindow();

  if (currentWindow) {
    clearInitialBootTimers(currentWindow);
  }

  const fallback = initialBootElement();

  if (!fallback) {
    return false;
  }

  fallback.remove();
  return true;
}
