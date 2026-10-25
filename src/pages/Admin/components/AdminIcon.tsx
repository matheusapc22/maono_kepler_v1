import type { ReactNode, SVGProps } from "react";

export type AdminIconName =
  | "shield"
  | "dashboard"
  | "building"
  | "map"
  | "users"
  | "file"
  | "request"
  | "audit"
  | "settings"
  | "chevron-left"
  | "chevron-right"
  | "arrow-right"
  | "return"
  | "logout";

const icons: Record<AdminIconName, ReactNode> = {
  shield: <path d="M12 2.5 21 6v6.2c0 5-4.5 8.3-9 10.3-4.5-2-9-5.3-9-10.3V6l9-3.5ZM7.5 12l3 3 6-6" />,
  dashboard: <><path d="M3 10h7V3H3v7ZM14 7h7V3h-7v4ZM14 21h7V11h-7v10ZM3 21h7v-7H3v7Z" /></>,
  building: <><path d="M5 22V2h14v20M2 22h20M10 22v-4h4v4M9 6h1m4 0h1M9 10h1m4 0h1M9 14h1m4 0h1" /></>,
  map: <path d="m3 5 6-3 6 3 6-3v17l-6 3-6-3-6 3V5Zm6-3v17m6-14v17" />,
  users: <><path d="M16 21v-3a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v3M16 4a4 4 0 0 1 0 8m3 2a5 5 0 0 1 3 4.6V21" /><circle cx="9" cy="6.5" r="4" /></>,
  file: <path d="M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-7-7Zm0 0v7h7M7 13h6m-6 4h10" />,
  request: <path d="m12 5 10 7-10 7L2 12l10-7Z" />,
  audit: <circle cx="12" cy="12" r="9" strokeDasharray="1.8 3.2" />,
  settings: <><path d="m9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1V3Z" transform="translate(1 0) scale(.92)" /><circle cx="12" cy="12" r="3.5" /></>,
  "chevron-left": <path d="m15 5-7 7 7 7" />,
  "chevron-right": <path d="m9 5 7 7-7 7" />,
  "arrow-right": <path d="M4 12h16m-6-6 6 6-6 6" />,
  return: <path d="M9 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5M8 12h13m-6-6 6 6-6 6" />,
  logout: <path d="M9 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5M8 12h13m-6-6 6 6-6 6" />,
};

export default function AdminIcon({ name, className = "", ...props }: SVGProps<SVGSVGElement> & { name: AdminIconName }) {
  return (
    <svg
      {...props}
      className={`admin-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icons[name]}
    </svg>
  );
}
