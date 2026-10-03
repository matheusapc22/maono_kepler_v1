// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// Presentation adapted from @kepler.gl/components 3.2.0.
// External Kepler documentation links are plain text; export behavior is unchanged.

import React, {useState} from 'react';
import JSONPretty from 'react-json-pretty';
import styled from 'styled-components';
import {StyledExportSection, Button} from '@kepler.gl/components/dist/common/styled-components';
import {StyledExportMapSection, StyledWarning} from '@kepler.gl/components/dist/modals/export-map-modal/components';
import {FormattedMessage} from '@kepler.gl/localization';
import {CopyToClipboard} from 'react-copy-to-clipboard';

const StyledJsonExportSection = styled(StyledExportSection)`
  .note {
    color: ${props => props.theme.errorColor};
    font-size: 11px;
  }

  .viewer {
    position: relative;
    border: 1px solid ${props => props.theme.selectBorderColorLT};
    background-color: white;
    border-radius: 2px;
    display: inline-block;
    font: inherit;
    line-height: 1.5em;
    padding: 0.5em 3.5em 0.5em 1em;
    margin: 0;
    box-sizing: border-box;
    height: 180px;
    width: 100%;
    overflow-y: scroll;
    overflow-x: auto;
    white-space: pre-wrap;
    word-wrap: break-word;
    max-width: 600px;
  }

  .copy-button {
    margin: 1em 1em 0 0;
    position: absolute;
    top: 0;
    right: 0;
  }
`;

type ExportJsonPropTypes = {
  config: unknown;
};

const ExportJsonMapUnmemoized = ({config = {}}: ExportJsonPropTypes) => {
  const [copied, setCopy] = useState(false);
  return (
    <div>
      <StyledExportMapSection>
        <div className="description" />
        <div className="selection">
          <FormattedMessage id={'modal.exportMap.json.selection'} />
        </div>
      </StyledExportMapSection>
      <StyledJsonExportSection className="export-map-modal__json-options">
        <div className="description">
          <div className="title">
            <FormattedMessage id={'modal.exportMap.json.configTitle'} />
          </div>
          <div className="subtitle">
            <FormattedMessage id={'modal.exportMap.json.configDisclaimer'} />
            <span>addDataToMap</span>.
          </div>
        </div>
        <div className="selection">
          <div className="viewer">
            <JSONPretty id="json-pretty" json={config} />
            <CopyToClipboard text={JSON.stringify(config)} onCopy={() => setCopy(true)}>
              <Button width="80px" className="copy-button">
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </CopyToClipboard>
          </div>
          <div className="disclaimer">
            <StyledWarning>
              <FormattedMessage id={'modal.exportMap.json.disclaimer'} />
            </StyledWarning>
          </div>
        </div>
      </StyledJsonExportSection>
    </div>
  );
};

ExportJsonMapUnmemoized.displayName = 'ExportJsonMap';

const ExportJsonMap = React.memo(ExportJsonMapUnmemoized);

const ExportJsonMapFactory = () => ExportJsonMap;

export default ExportJsonMapFactory;
