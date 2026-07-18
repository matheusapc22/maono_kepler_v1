import type { SVGProps } from "react";

export default function HeadsetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <path d="M4 13h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1v-6Z" />
      <path d="M20 13h-2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-6Z" />
      <path d="M16 20a4 4 0 0 1-4 2" />
    </svg>
  );
}
