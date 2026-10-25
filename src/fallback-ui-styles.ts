// Projects and the Admin workspace own their visual themes. Keep the legacy
// fallback for other shells. The existing :not() list preserves specificity;
// chaining another :not(.class) would unintentionally increase it. Keep neutral resets.
const FALLBACK_STYLE_ID = "maono-ui-fallback-styles";

const fallbackCss = `
  html, body, #root {
    min-height: 100%;
    margin: 0;
  }

  body {
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) {
    min-height: 100vh;
    background: #0f172a;
    color: #ffffff;
    box-sizing: border-box;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) * {
    box-sizing: border-box;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) header {
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) header > div,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) > section {
    width: min(100% - 48px, 1280px);
    margin-left: auto;
    margin-right: auto;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) header > div {
    min-height: 88px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 0;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) header img {
    max-height: 48px;
    width: auto;
    object-fit: contain;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) header h1,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) h2,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) h3,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) h4,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) p {
    margin-top: 0;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) header h1 {
    margin-bottom: 2px;
    font-size: 20px;
    line-height: 1.25;
    font-weight: 700;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) header p,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) section p {
    color: rgba(255, 255, 255, 0.68);
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) > section {
    padding-top: 32px;
    padding-bottom: 32px;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) > section > div {
    display: grid;
    gap: 24px;
  }

  @media (min-width: 1280px) {
    #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) > section > div:first-of-type {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) section section,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) > section > section {
    margin-top: 32px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.055);
    padding: 24px;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) > section > div > section {
    margin-top: 0;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) form {
    margin-top: 20px;
    display: grid;
    gap: 16px;
  }

  @media (min-width: 768px) {
    #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) form {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) > section > section form {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) label {
    display: block;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) label > span {
    display: block;
    margin-bottom: 6px;
    color: rgba(255, 255, 255, 0.78);
    font-size: 14px;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) input,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) select,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) textarea {
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

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) input:focus,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) select:focus,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) textarea:focus {
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.45);
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) button,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) a {
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

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) button:hover,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) a:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) button[type="submit"] {
    border-color: transparent;
    background: #3b82f6;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) button[type="submit"]:hover {
    background: #60a5fa;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) th,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) td {
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    padding: 12px 16px 12px 0;
    text-align: left;
    vertical-align: middle;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) th {
    color: rgba(255, 255, 255, 0.62);
    font-weight: 700;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) td {
    color: rgba(255, 255, 255, 0.9);
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) strong {
    color: #ffffff;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) ul {
    margin-top: 8px;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) .overflow-x-auto,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) .overflow-auto {
    overflow: auto;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) .max-h-72 {
    max-height: 18rem;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) .text-red-100 {
    color: #fee2e2;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) .text-emerald-100 {
    color: #d1fae5;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) .text-yellow-100 {
    color: #fef3c7;
  }

  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) .text-blue-200,
  #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) .text-blue-100 {
    color: #bfdbfe;
  }

  @media (max-width: 767px) {
    #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) header > div {
      flex-direction: column;
      align-items: flex-start;
    }

    #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) header > div,
    #root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace) > section {
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