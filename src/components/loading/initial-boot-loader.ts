function browserWindow() {
  return typeof window === "undefined" ? null : (window as any);
}

export function hasInitialBootLoader() {
  return (
    typeof document !== "undefined" &&
    document.getElementById("app-boot-fallback") !== null
  );
}

export function acknowledgeInitialBootRuntime() {
  const currentWindow = browserWindow();

  if (!currentWindow) {
    return;
  }

  if (currentWindow.__MAONO_BOOT_TIMEOUT__) {
    window.clearTimeout(currentWindow.__MAONO_BOOT_TIMEOUT__);
    currentWindow.__MAONO_BOOT_TIMEOUT__ = undefined;
  }
}

export function completeInitialBootLoader() {
  acknowledgeInitialBootRuntime();

  if (typeof document === "undefined") {
    return false;
  }

  const fallback = document.getElementById("app-boot-fallback");

  if (!fallback) {
    return false;
  }

  fallback.remove();
  return true;
}
