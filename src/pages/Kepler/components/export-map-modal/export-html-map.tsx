// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// Presentation adapted from @kepler.gl/components 3.2.0.
// External documentation prompts are omitted; export behavior and warnings are unchanged.

import React from 'react';
import {StyledExportSection, StyledType, CheckMark} from '@kepler.gl/components/dist/common/styled-components';
import {StyledExportMapSection, StyledWarning} from '@kepler.gl/components/dist/modals/export-map-modal/components';
import {
  EXPORT_HTML_MAP_MODE_OPTIONS
} from '@kepler.gl/constants';
import styled from 'styled-components';
import {injectIntl} from 'react-intl';
import {FormattedMessage} from '@kepler.gl/localization';
import type {IntlShape} from 'react-intl';

import type {setUserMapboxAccessToken, setExportHTMLMapMode, ActionHandler} from '@kepler.gl/actions';

const ExportMapStyledExportSection = styled(StyledExportSection)`
  .disclaimer {
    font-size: ${props => props.theme.inputFontSize};
    color: ${props => props.theme.inputColor};
    margin-top: 12px;
  }
`;

interface StyledInputProps {
  error?: boolean;
}

const StyledInput = styled.input<StyledInputProps>`
  width: 100%;
  padding: ${props => props.theme.inputPadding};
  color: ${props => (props.error ? 'red' : props.theme.titleColorLT)};
  height: ${props => props.theme.inputBoxHeight};
  outline: 0;
  font-size: ${props => props.theme.inputFontSize};

  &:active,
  &:focus,
  &.focus,
  &.active {
    outline: 0;
  }
`;

const BigStyledTile = styled(StyledType)`
  height: unset;
  width: unset;
  img {
    width: 180px;
    height: 120px;
  }
`;

type ExportHtmlMapProps = {
  onChangeExportMapHTMLMode: ActionHandler<typeof setExportHTMLMapMode>;
  onEditUserMapboxAccessToken: ActionHandler<typeof setUserMapboxAccessToken>;
  options: {
    userMapboxToken?: string;
    mode?: string;
  };
};

type IntlProps = {
  intl: IntlShape;
};

function ExportHtmlMapFactory(): React.ComponentType<ExportHtmlMapProps> {
  const ExportHtmlMap = ({
    onChangeExportMapHTMLMode = () => {
      return;
    },
    onEditUserMapboxAccessToken = () => {
      return;
    },
    options = {},
    intl
  }: ExportHtmlMapProps & IntlProps) => (
    <div>
      <StyledExportMapSection>
        <div className="description" />
        <div className="selection">
          <FormattedMessage id={'modal.exportMap.html.selection'} />
        </div>
      </StyledExportMapSection>
      <ExportMapStyledExportSection className="export-map-modal__html-options">
        <div className="description">
          <div className="title">
            <FormattedMessage id={'modal.exportMap.html.tokenTitle'} />
          </div>
          <div className="subtitle">
            <FormattedMessage id={'modal.exportMap.html.tokenSubtitle'} />
          </div>
        </div>
        <div className="selection">
          <StyledInput
            onChange={e => onEditUserMapboxAccessToken(e.target.value)}
            type="text"
            placeholder={intl.formatMessage({id: 'modal.exportMap.html.tokenPlaceholder'})}
            value={options ? options.userMapboxToken : ''}
          />
          <div className="disclaimer">
            <StyledWarning>
              <FormattedMessage id={'modal.exportMap.html.tokenMisuseWarning'} />
            </StyledWarning>
          </div>
        </div>
      </ExportMapStyledExportSection>
      <ExportMapStyledExportSection>
        <div className="description">
          <div className="title">
            <FormattedMessage id={'modal.exportMap.html.modeTitle'} />
          </div>
        </div>
        <div className="selection">
          {EXPORT_HTML_MAP_MODE_OPTIONS.map(mode => (
            <BigStyledTile
              key={mode.id}
              selected={options.mode === mode.id}
              onClick={() => mode.available && onChangeExportMapHTMLMode(mode.id)}
            >
              <img src={mode.url} alt="" />
              <p>
                <FormattedMessage
                  id={'modal.exportMap.html.modeDescription'}
                  values={{mode: intl.formatMessage({id: mode.label})}}
                />
              </p>
              {options.mode === mode.id && <CheckMark />}
            </BigStyledTile>
          ))}
        </div>
      </ExportMapStyledExportSection>
    </div>
  );

  ExportHtmlMap.displayName = 'ExportHtmlMap';

  return injectIntl(ExportHtmlMap);
}

export default ExportHtmlMapFactory;
