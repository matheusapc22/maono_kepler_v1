const FALLBACK_STYLE_ID = "maono-ui-fallback-styles";

const fallbackCss = `
  html, body, #root {
    min-height: 100%;
    margin: 0;
  }

  body {
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  #root > main {
    min-height: 100vh;
    background: #0f172a;
    color: #ffffff;
    box-sizing: border-box;
  }

  #root > main * {
    box-sizing: border-box;
  }

  #root > main header {
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
  }

  #root > main header > div,
  #root > main > section {
    width: min(100% - 48px, 1280px);
    margin-left: auto;
    margin-right: auto;
  }

  #root > main header > div {
    min-height: 88px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 0;
  }

  #root > main header img {
    max-height: 48px;
    width: auto;
    object-fit: contain;
  }

  #root > main header h1,
  #root > main h2,
  #root > main h3,
  #root > main h4,
  #root > main p {
    margin-top: 0;
  }

  #root > main header h1 {
    margin-bottom: 2px;
    font-size: 20px;
    line-height: 1.25;
    font-weight: 700;
  }

  #root > main header p,
  #root > main section p {
    color: rgba(255, 255, 255, 0.68);
  }

  #root > main > section {
    padding-top: 32px;
    padding-bottom: 32px;
  }

  #root > main > section > div {
    display: grid;
    gap: 24px;
  }

  @media (min-width: 1280px) {
    #root > main > section > div:first-of-type {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  #root > main section section,
  #root > main > section > section {
    margin-top: 32px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.055);
    padding: 24px;
  }

  #root > main > section > div > section {
    margin-top: 0;
  }

  #root > main form {
    margin-top: 20px;
    display: grid;
    gap: 16px;
  }

  @media (min-width: 768px) {
    #root > main form {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    #root > main > section > section form {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  #root > main label {
    display: block;
  }

  #root > main label > span {
    display: block;
    margin-bottom: 6px;
    color: rgba(255, 255, 255, 0.78);
    font-size: 14px;
  }

  #root > main input,
  #root > main select,
  #root > main textarea {
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

  #root > main input:focus,
  #root > main select:focus,
  #root > main textarea:focus {
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.45);
  }

  #root > main button,
  #root > main a {
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

  #root > main button:hover,
  #root > main a:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  #root > main button[type="submit"] {
    border-color: transparent;
    background: #3b82f6;
  }

  #root > main button[type="submit"]:hover {
    background: #60a5fa;
  }

  #root > main button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  #root > main table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  #root > main th,
  #root > main td {
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    padding: 12px 16px 12px 0;
    text-align: left;
    vertical-align: middle;
  }

  #root > main th {
    color: rgba(255, 255, 255, 0.62);
    font-weight: 700;
  }

  #root > main td {
    color: rgba(255, 255, 255, 0.9);
  }

  #root > main strong {
    color: #ffffff;
  }

  #root > main ul {
    margin-top: 8px;
  }

  #root > main .overflow-x-auto,
  #root > main .overflow-auto {
    overflow: auto;
  }

  #root > main .max-h-72 {
    max-height: 18rem;
  }

  #root > main .text-red-100 {
    color: #fee2e2;
  }

  #root > main .text-emerald-100 {
    color: #d1fae5;
  }

  #root > main .text-yellow-100 {
    color: #fef3c7;
  }

  #root > main .text-blue-200,
  #root > main .text-blue-100 {
    color: #bfdbfe;
  }

  @media (max-width: 767px) {
    #root > main header > div {
      flex-direction: column;
      align-items: flex-start;
    }

    #root > main header > div,
    #root > main > section {
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
