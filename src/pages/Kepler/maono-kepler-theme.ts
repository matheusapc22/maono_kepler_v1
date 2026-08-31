// SPDX-License-Identifier: MIT
// Central bridge between Kepler.gl's v3 theme object and the Maõno brand contract.
//
// The CSS source of truth remains src/maono-design-tokens.css. The three values
// below mirror the mandatory brand tokens and are guarded by
// tests/maono-map-accent.test.mjs so the JS theme cannot drift from the CSS
// contract. Kepler theme values stay as concrete colors because upstream
// components may process them in JavaScript before styled-components renders.

import { theme as keplerTheme } from "@kepler.gl/styles";

export const MAONO_KEPLER_ACCENT = "#c5a059";
export const MAONO_KEPLER_ACCENT_BRIGHT = "#f2c766";
export const MAONO_KEPLER_ACCENT_TEXT = "#f3d58a";

export const MAONO_KEPLER_THEME_OVERRIDES = Object.freeze({
  // Core active/selected identity.
  activeColor: MAONO_KEPLER_ACCENT,
  activeColorHover: MAONO_KEPLER_ACCENT_BRIGHT,
  logoColor: MAONO_KEPLER_ACCENT,

  // Primary and CTA buttons. Kepler v3 defaults these keys to emerald green.
  primaryBtnBgd: MAONO_KEPLER_ACCENT,
  primaryBtnActBgd: MAONO_KEPLER_ACCENT_BRIGHT,
  primaryBtnBgdHover: MAONO_KEPLER_ACCENT_BRIGHT,
  primaryBtnColor: "#0b0d11",
  primaryBtnActColor: "#0b0d11",
  ctaBtnBgd: MAONO_KEPLER_ACCENT,
  ctaBtnActBgd: MAONO_KEPLER_ACCENT_BRIGHT,
  ctaBtnBgdHover: MAONO_KEPLER_ACCENT_BRIGHT,
  ctaBtnColor: "#0b0d11",
  ctaBtnActColor: "#0b0d11",

  // Selection controls and form states rendered by native Kepler components.
  selectionBtnActColor: MAONO_KEPLER_ACCENT,
  selectionBtnBgdHover: MAONO_KEPLER_ACCENT,
  selectionBtnBorderActColor: MAONO_KEPLER_ACCENT,
  switchTrackBgdActive: MAONO_KEPLER_ACCENT,
  checkboxBoxBgdChecked: MAONO_KEPLER_ACCENT,
  inputBorderActiveColor: MAONO_KEPLER_ACCENT,
  selectActiveBorderColor: MAONO_KEPLER_ACCENT,

  // Native filter histogram and panel emphasis.
  histogramFillInRange: MAONO_KEPLER_ACCENT,
  layerPanelToggleOptionColorActive: MAONO_KEPLER_ACCENT_TEXT,
  panelHeaderIconActive: MAONO_KEPLER_ACCENT_TEXT,
});

// index.tsx already provides this exact exported object to ThemeProvider.
// Mutating it once during module initialization lets the Maõno shell preserve
// the existing provider architecture while replacing Kepler's green/cyan
// branding at its source instead of chasing generated styled-component classes.
Object.assign(keplerTheme, MAONO_KEPLER_THEME_OVERRIDES);

export const maonoKeplerTheme = keplerTheme;
