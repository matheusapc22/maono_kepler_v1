const FALLBACK_STYLE_ID = "maono-ui-fallback-styles";

const fallbackCss = `
  html, body, #root {
    min-height: 100%;
    margin: 0;
  }

  body {
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  #root > main:not(.maono-login-page) {
    min-height: 100vh;
    background: #0f172a;
    color: #ffffff;
    box-sizing: border-box;
  }

  #root > main:not(.maono-login-page) * {
    box-sizing: border-box;
  }

  #root > main:not(.maono-login-page) header {
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
  }

  #root > main:not(.maono-login-page) header > div,
  #root > main:not(.maono-login-page) > section {
    width: min(100% - 48px, 1280px);
    margin-left: auto;
    margin-right: auto;
  }

  #root > main:not(.maono-login-page) header > div {
    min-height: 88px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 0;
  }

  #root > main:not(.maono-login-page) header img {
    max-height: 48px;
    width: auto;
    object-fit: contain;
  }

  #root > main:not(.maono-login-page) header h1,
  #root > main:not(.maono-login-page) h2,
  #root > main:not(.maono-login-page) h3,
  #root > main:not(.maono-login-page) h4,
  #root > main:not(.maono-login-page) p {
    margin-top: 0;
  }

  #root > main:not(.maono-login-page) header h1 {
    margin-bottom: 2px;
    font-size: 20px;
    line-height: 1.25;
    font-weight: 700;
  }

  #root > main:not(.maono-login-page) header p,
  #root > main:not(.maono-login-page) section p {
    color: rgba(255, 255, 255, 0.68);
  }

  #root > main:not(.maono-login-page) > section {
    padding-top: 32px;
    padding-bottom: 32px;
  }

  #root > main:not(.maono-login-page) > section > div {
    display: grid;
    gap: 24px;
  }

  @media (min-width: 1280px) {
    #root > main:not(.maono-login-page) > section > div:first-of-type {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  #root > main:not(.maono-login-page) section section,
  #root > main:not(.maono-login-page) > section > section {
    margin-top: 32px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.055);
    padding: 24px;
  }

  #root > main:not(.maono-login-page) > section > div > section {
    margin-top: 0;
  }

  #root > main:not(.maono-login-page) form {
    margin-top: 20px;
    display: grid;
    gap: 16px;
  }

  @media (min-width: 768px) {
    #root > main:not(.maono-login-page) form {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    #root > main:not(.maono-login-page) > section > section form {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  #root > main:not(.maono-login-page) label {
    display: block;
  }

  #root > main:not(.maono-login-page) label > span {
    display: block;
    margin-bottom: 6px;
    color: rgba(255, 255, 255, 0.78);
    font-size: 14px;
  }

  #root > main:not(.maono-login-page) input,
  #root > main:not(.maono-login-page) select,
  #root > main:not(.maono-login-page) textarea {
    width: 100%;
    min-height: 48px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 14px;
    background: #ffffff !important;
    color: #0f172a !important;
    -webkit-text-fill-color: #0f172a !important;
    caret-color: #0f172a !important;
    padding: 10px 14px;
    font: inherit;
    outline: none;
  }

  #root > main:not(.maono-login-page) input:focus,
  #root > main:not(.maono-login-page) select:focus,
  #root > main:not(.maono-login-page) textarea:focus {
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.45);
  }

  #root > main:not(.maono-login-page) button,
  #root > main:not(.maono-login-page) a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 12px;
    background: transparent;
    color: #ffffff;
    padding: 8px 14px;
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }

  #root > main:not(.maono-login-page) button:hover,
  #root > main:not(.maono-login-page) a:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  #root > main:not(.maono-login-page) button[type="submit"] {
    border-color: transparent;
    background: #3b82f6;
  }

  #root > main:not(.maono-login-page) button[type="submit"]:hover {
    background: #60a5fa;
  }

  #root > main:not(.maono-login-page) button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  #root > main:not(.maono-login-page) table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  #root > main:not(.maono-login-page) th,
  #root > main:not(.maono-login-page) td {
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    padding: 12px 16px 12px 0;
    text-align: left;
    vertical-align: middle;
  }

  #root > main:not(.maono-login-page) th {
    color: rgba(255, 255, 255, 0.62);
    font-weight: 700;
  }

  #root > main:not(.maono-login-page) td {
    color: rgba(255, 255, 255, 0.9);
  }

  #root > main:not(.maono-login-page) strong {
    color: #ffffff;
  }

  #root > main:not(.maono-login-page) ul {
    margin-top: 8px;
  }

  #root > main:not(.maono-login-page) .overflow-x-auto,
  #root > main:not(.maono-login-page) .overflow-auto {
    overflow: auto;
  }

  #root > main:not(.maono-login-page) .max-h-72 {
    max-height: 18rem;
  }

  #root > main:not(.maono-login-page) .text-red-100 {
    color: #fee2e2;
  }

  #root > main:not(.maono-login-page) .text-emerald-100 {
    color: #d1fae5;
  }

  #root > main:not(.maono-login-page) .text-yellow-100 {
    color: #fef3c7;
  }

  #root > main:not(.maono-login-page) .text-blue-200,
  #root > main:not(.maono-login-page) .text-blue-100 {
    color: #bfdbfe;
  }

  @media (max-width: 767px) {
    #root > main:not(.maono-login-page) header > div {
      flex-direction: column;
      align-items: flex-start;
    }

    #root > main:not(.maono-login-page) header > div,
    #root > main:not(.maono-login-page) > section {
      width: min(100% - 24px, 1280px);
    }
  }
`;

function injectFallbackStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(FALLBACK_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = FALLBACK_STYLE_ID;
  style.textContent = fallbackCss;
  document.head.appendChild(style);
}

injectFallbackStyles();

export {};