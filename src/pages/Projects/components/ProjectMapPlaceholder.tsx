import React from "react";

import type { ProjectListItem } from "../projects-api";
import {
  normalizeProjectThumbnailStatus,
  projectThumbnailStatusLabel,
} from "./project-card-utils";

const PALETTES = [
  ["#0b1715", "#183d34", "#d9a441", "#f5d486"],
  ["#101812", "#24452d", "#d6a03e", "#f0c96d"],
  ["#121616", "#284344", "#c99638", "#edd083"],
  ["#0d1519", "#173a49", "#d8a43e", "#f2d47c"],
  ["#15130f", "#44331e", "#c99031", "#f1cc72"],
  ["#10151a", "#2c3442", "#d5a03b", "#f4d783"],
] as const;

const MAP_LINES = [
  "M-20 226 C130 104 248 264 390 144 S666 44 820 176 S1050 240 1100 96",
  "M-50 132 C112 226 242 38 406 132 S698 272 1010 72",
  "M-20 312 C176 196 266 368 478 238 S780 118 1020 248",
] as const;

function stableSeed(project: ProjectListItem) {
  const value = `${String(
    project.organizationId ?? project.organization_id ?? "",
  )}:${project.slug}`;
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

const ProjectMapPlaceholder: React.FC<{
  project: ProjectListItem;
  imageFailed?: boolean;
}> = ({ project, imageFailed = false }) => {
  const seed = stableSeed(project);
  const palette = PALETTES[seed % PALETTES.length];
  const lineOffset = seed % MAP_LINES.length;
  const status = imageFailed
    ? "MISSING"
    : normalizeProjectThumbnailStatus(project.thumbnailStatus);
  const statusLabel =
    imageFailed
      ? "Prévia temporariamente indisponível"
      : projectThumbnailStatusLabel(status);

  return (
    <div
      className="mm-project-map-placeholder"
      role="img"
      aria-label={`Mapa ilustrativo do projeto ${project.name}${
        statusLabel ? `. ${statusLabel}.` : ""
      }`}
      data-preview-status={status}
      style={
        {
          "--mm-map-background": palette[0],
          "--mm-map-land": palette[1],
          "--mm-map-line": palette[2],
          "--mm-map-point": palette[3],
        } as React.CSSProperties
      }
    >
      <svg
        viewBox="0 0 960 540"
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="xMidYMid slice"
      >
        <rect width="960" height="540" fill={palette[0]} />
        <path
          d="M-60 50 150 14l104 88 168-44 126 88 206-72 266 70v396H-60Z"
          fill={palette[1]}
          opacity=".82"
        />
        <path
          d="M-40 454 92 338l150 34 132-98 190 54 118-116 328 58v270H-40Z"
          fill={palette[1]}
          opacity=".58"
        />
        {[0, 1, 2].map((index) => (
          <path
            key={index}
            d={MAP_LINES[(lineOffset + index) % MAP_LINES.length]}
            fill="none"
            stroke={index === 0 ? palette[2] : palette[3]}
            strokeLinecap="round"
            strokeWidth={index === 0 ? 7 : 3}
            opacity={index === 0 ? 0.9 : 0.52}
          />
        ))}
        <g fill={palette[3]}>
          <circle cx={142 + (seed % 70)} cy="184" r="10" />
          <circle cx="466" cy={264 + (seed % 45)} r="8" />
          <circle cx={704 + (seed % 90)} cy="162" r="12" />
        </g>
        <g
          fill="none"
          stroke={palette[2]}
          strokeWidth="2"
          opacity=".24"
        >
          <path d="M0 90h960M0 180h960M0 270h960M0 360h960M0 450h960" />
          <path d="M120 0v540M240 0v540M360 0v540M480 0v540M600 0v540M720 0v540M840 0v540" />
        </g>
      </svg>

      {statusLabel ? (
        <span
          className={`mm-project-map-placeholder__status is-${status.toLowerCase()}`}
        >
          {status === "PENDING" ? (
            <span
              className="mm-project-map-placeholder__status-dot"
              aria-hidden="true"
            />
          ) : null}
          {statusLabel}
        </span>
      ) : null}
    </div>
  );
};

export default ProjectMapPlaceholder;
