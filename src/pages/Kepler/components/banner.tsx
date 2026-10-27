import type { ReactNode } from "react";
// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import styled from "styled-components";
import { Icons } from "@kepler.gl/components";

const StyledBanner = styled.div<{bgColor: string; fontColor: string; height: number; visible?: boolean}>`
  align-items: center;
  background-color: ${(props) => props.bgColor};
  color: ${(props) => props.fontColor};
  display: flex;
  height: ${(props) => props.height}px;
  justify-content: space-between;
  padding: 0 40px;
  position: absolute;
  transition: top 1s;
  width: 100%;
  z-index: 9999;

  svg:hover {
    cursor: pointer;
  }

  top: ${(props) => (props.visible ? 0 : -100)}px;
`;

const Banner = ({
  bgColor = "#1F7CF4",
  fontColor = "#FFFFFF",
  height = 30,
  children,
  onClose,
  show,
}: { bgColor?: string; fontColor?: string; height?: number; children?: ReactNode; onClose?: () => void; show?: boolean }) => (
  <StyledBanner
    className="top-banner"
    bgColor={bgColor}
    fontColor={fontColor}
    height={height}
    visible={show}
  >
    <div>{children}</div>
    <Icons.Delete height="14px" onClick={onClose} />
  </StyledBanner>
);

export default Banner;
