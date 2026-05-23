function isAdminFilesPage() {
  return window.location.pathname === "/admin/files";
}

function getSyncButtonId() {
  return "maono-sync-dropbox-organizations";
}

function setButtonState(button: HTMLButtonElement, loading: boolean) {
  button.disabled = loading;
  button.textContent = loading ? "Sincronizando Dropbox..." : "Sincronizar pastas Dropbox";
  button.style.opacity = loading ? "0.7" : "1";
  button.style.cursor = loading ? "wait" : "pointer";
}

function showAdminSyncMessage(message: string, type: "success" | "error") {
  const existing = document.getElementById("maono-sync-dropbox-message");
  existing?.remove();

  const box = document.createElement("div");
  box.id = "maono-sync-dropbox-message";
  box.textContent = message;
  box.style.position = "fixed";
  box.style.right = "24px";
  box.style.top = "88px";
  box.style.zIndex = "9999";
  box.style.maxWidth = "420px";
  box.style.padding = "14px 16px";
  box.style.borderRadius = "14px";
  box.style.fontSize = "14px";
  box.style.fontWeight = "600";
  box.style.color = "#ffffff";
  box.style.border = type === "success" ? "1px solid rgba(16, 185, 129, 0.55)" : "1px solid rgba(248, 113, 113, 0.55)";
  box.style.background = type === "success" ? "rgba(6, 78, 59, 0.95)" : "rgba(127, 29, 29, 0.95)";
  box.style.boxShadow = "0 18px 45px rgba(0, 0, 0, 0.35)";

  document.body.appendChild(box);
  window.setTimeout(() => box.remove(), 6500);
}

async function syncDropboxOrganizations(button: HTMLButtonElement) {
  setButtonState(button, true);

  try {
    const response = await fetch("/api/admin/organizations/sync-dropbox?rootPath=/projects", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    const data = await response.json();

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error?.message || "Falha ao sincronizar Dropbox.");
    }

    showAdminSyncMessage(
      `Sincronização concluída: ${data.organizationsSynced || 0} organização(ões) sincronizada(s) a partir de ${data.foldersFound || 0} pasta(s).`,
      "success"
    );

    window.setTimeout(() => window.location.reload(), 850);
  } catch (error) {
    showAdminSyncMessage(error instanceof Error ? error.message : "Erro ao sincronizar Dropbox.", "error");
    setButtonState(button, false);
  }
}

function injectDropboxSyncButton() {
  if (!isAdminFilesPage()) return;
  if (document.getElementById(getSyncButtonId())) return;

  const header = Array.from(document.querySelectorAll("h2")).find((item) =>
    item.textContent?.includes("Organizações cadastradas")
  );

  if (!header) return;

  const section = header.closest("section");
  if (!section) return;

  const button = document.createElement("button");
  button.id = getSyncButtonId();
  button.type = "button";
  button.textContent = "Sincronizar pastas Dropbox";
  button.style.marginTop = "14px";
  button.style.marginBottom = "8px";
  button.style.borderRadius = "12px";
  button.style.border = "1px solid rgba(147, 197, 253, 0.45)";
  button.style.background = "rgba(37, 99, 235, 0.92)";
  button.style.color = "#ffffff";
  button.style.padding = "10px 14px";
  button.style.fontSize = "14px";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 10px 24px rgba(37, 99, 235, 0.22)";

  button.addEventListener("click", () => syncDropboxOrganizations(button));

  const helper = document.createElement("p");
  helper.textContent = "Detecta automaticamente as pastas dentro de /projects no Dropbox e cadastra como organizações ativas.";
  helper.style.fontSize = "12px";
  helper.style.color = "rgba(255, 255, 255, 0.62)";
  helper.style.marginTop = "0";
  helper.style.marginBottom = "12px";

  header.parentElement?.appendChild(button);
  header.parentElement?.appendChild(helper);
}

function scheduleDropboxSyncButtonInjection() {
  window.setTimeout(injectDropboxSyncButton, 300);
  window.setTimeout(injectDropboxSyncButton, 900);
  window.setTimeout(injectDropboxSyncButton, 1800);
}

window.addEventListener("DOMContentLoaded", scheduleDropboxSyncButtonInjection);
window.addEventListener("popstate", scheduleDropboxSyncButtonInjection);

const originalPushState = window.history.pushState;
window.history.pushState = function pushStateWithDropboxSyncButton(...args) {
  const result = originalPushState.apply(this, args);
  scheduleDropboxSyncButtonInjection();
  return result;
};

scheduleDropboxSyncButtonInjection();

export {};
