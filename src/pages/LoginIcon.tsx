import type { ReactNode } from "react";

type LoginIconName = "mail" | "lock" | "eye" | "eye-off" | "arrow-right";

// Small route-local vectors, following the existing application's SVG pattern.
const paths: Record<LoginIconName, ReactNode> = {
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 6 8 6 8-6" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
  "eye-off": <><path d="m3 3 18 18M10.6 6.1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.2 7.3A18 18 0 0 0 2 12s3.5 6 10 6a12 12 0 0 0 4.4-.8M10.2 10.2a2.5 2.5 0 0 0 3.6 3.6" /></>,
  "arrow-right": <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
};

export default function LoginIcon({ name }: { name: LoginIconName }) {
  return <svg data-login-icon={name} viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
