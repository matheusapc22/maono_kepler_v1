// SPDX-License-Identifier: MIT
// @ts-nocheck

import React from "react";
import { LegendRowFactory } from "@kepler.gl/components";

const MAONO_LEGEND_TERMS_PT_BR = Object.freeze({
  "fill color": "Cor de preenchimento",
  fill: "Preenchimento",
  outline: "Contorno",
  "stroke color": "Cor do contorno",
  stroke: "Traçado",
  color: "Cor",
  radius: "Raio",
  weight: "Espessura",
  "point count": "Contagem de pontos",
  "no value": "Sem valor",
});

const KEPLER_SI_MULTIPLIER = Object.freeze({
  k: 1_000,
  M: 1_000_000,
  G: 1_000_000_000,
  T: 1_000_000_000_000,
});

const PT_BR_NUMBER = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});

/**
 * O Kepler usa d3-format em inglês para a legenda (ex.: 505.3k, 1.027M).
 * Aqui convertemos o token de volta para o valor numérico antes de aplicar a
 * apresentação Maõno. Isso evita trocar apenas ponto por vírgula e acabar
 * confundindo decimal com separador de milhar.
 */
export function parseKeplerLegendNumber(token) {
  if (typeof token !== "string") return null;

  const match = token
    .trim()
    .match(/^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?([kMGT])?$/);

  if (!match) return null;

  const [, sign, integerPart, decimalPart = "", suffix = ""] = match;
  const normalized = `${sign}${integerPart.replace(/,/g, "")}${
    decimalPart ? `.${decimalPart}` : ""
  }`;
  const baseValue = Number(normalized);
  if (!Number.isFinite(baseValue)) return null;

  return baseValue * (KEPLER_SI_MULTIPLIER[suffix] || 1);
}

function formatScaledNumber(value, divisor, suffix) {
  return `${PT_BR_NUMBER.format(value / divisor)} ${suffix}`;
}

/**
 * Regras de leitura da legenda Maõno:
 * - abaixo de 1.000: número completo, sem "k";
 * - de 1.000 a 9.999: número completo com separador pt-BR;
 * - de 10 mil a 999.999: usa "mil" em vez do "k" inglês;
 * - de 1 milhão a 999.999.999: usa "M";
 * - bilhões/trilhões seguem abreviações pt-BR para não voltar ao SI inglês.
 */
export function formatMaonoLegendNumber(value) {
  if (!Number.isFinite(value)) return String(value ?? "");

  const absolute = Math.abs(value);
  if (absolute < 10_000) {
    return PT_BR_NUMBER.format(value);
  }
  if (absolute < 1_000_000) {
    return formatScaledNumber(value, 1_000, "mil");
  }
  if (absolute < 1_000_000_000) {
    return formatScaledNumber(value, 1_000_000, "M");
  }
  if (absolute < 1_000_000_000_000) {
    return formatScaledNumber(value, 1_000_000_000, "bi");
  }
  return formatScaledNumber(value, 1_000_000_000_000, "tri");
}

function formatNumericToken(token) {
  const value = parseKeplerLegendNumber(token);
  return value === null ? null : formatMaonoLegendNumber(value);
}

function formatQuantitativeLegendLabel(label) {
  const trimmed = label.trim();

  const directNumber = formatNumericToken(trimmed);
  if (directNumber !== null) return directNumber;

  const lessThan = trimmed.match(/^Less than\s+(.+)$/i);
  if (lessThan) {
    const value = formatNumericToken(lessThan[1]);
    if (value !== null) return `Menor que ${value}`;
  }

  const orMore = trimmed.match(/^(.+?)\s+or more$/i);
  if (orMore) {
    const value = formatNumericToken(orMore[1]);
    if (value !== null) return `${value} ou mais`;
  }

  const range = trimmed.match(/^(.+?)\s+to\s+(.+?)$/i);
  if (range) {
    const start = formatNumericToken(range[1]);
    const end = formatNumericToken(range[2]);
    if (start !== null && end !== null) return `${start} a ${end}`;
  }

  return null;
}

/**
 * Localiza somente o conteúdo textual produzido pela legenda nativa do Kepler.
 * Nomes de camada/campo e rótulos categóricos do usuário permanecem intactos.
 */
export function formatMaonoLegendLabel(label) {
  if (typeof label !== "string") return label;

  const translatedTerm = MAONO_LEGEND_TERMS_PT_BR[label.trim().toLowerCase()];
  if (translatedTerm) return translatedTerm;

  return formatQuantitativeLegendLabel(label) ?? label;
}

MaonoLegendRowFactory.deps = LegendRowFactory.deps;

export function MaonoLegendRowFactory(...deps) {
  const NativeLegendRow = LegendRowFactory(...deps);

  const MaonoLegendRow = (props) => (
    <NativeLegendRow
      {...props}
      label={formatMaonoLegendLabel(props.label)}
    />
  );

  MaonoLegendRow.displayName = "MaonoLegendRow";
  return MaonoLegendRow;
}

export function replaceLegendRow() {
  return [LegendRowFactory, MaonoLegendRowFactory];
}
