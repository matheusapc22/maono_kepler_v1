// @ts-nocheck
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./maono-design-tokens.css";
import "./pages/Projects/maono-form-accent.css";
import "./index.css";
import "./platform-layout.css";
import "./components/loading/Skeleton.css";
import "./fallback-ui-styles";
import "./auto-project-id";
import "./dropbox-sync-ui";
import App from "./App.tsx";
import { Provider } from "react-redux";
import store from "./store";
import { BrowserRouter } from "react-router";
import { SessionProvider } from "./auth/session";
import { installMapLoadObservability } from "./pages/Kepler/observability/map-load-runtime";

function enableWebglScreenshotReadback() {
  if (typeof window === "undefined") return;
  if (window.__MAONO_WEBGL_READBACK_PATCHED__) return;
  if (!window.HTMLCanvasElement?.prototype?.getContext) return;

  window.__MAONO_WEBGL_READBACK_PATCHED__ = true;

  const originalGetContext = window.HTMLCanvasElement.prototype.getContext;

  window.HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, attributes) {
    const contextType = String(type || "").toLowerCase();

    if (["webgl", "webgl2", "experimental-webgl"].includes(contextType)) {
      return originalGetContext.call(this, type, {
        ...(attributes || {}),
        preserveDrawingBuffer: true,
      });
    }

    return originalGetContext.call(this, type, attributes);
  };
}

// A geração de preview PNG precisa ler o conteúdo do canvas WebGL.
// Mapbox/deck.gl podem limpar o backbuffer após renderização; com preserveDrawingBuffer
// o canvas fica legível para toDataURL/drawImage no momento do salvamento.
enableWebglScreenshotReadback();
installMapLoadObservability();

if (typeof window !== "undefined" && window.__MAONO_BOOT_TIMEOUT__) {
  window.clearTimeout(window.__MAONO_BOOT_TIMEOUT__);
  window.__MAONO_BOOT_TIMEOUT__ = undefined;
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Elemento raiz da aplicação não foi encontrado.");
}

createRoot(rootElement).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);
