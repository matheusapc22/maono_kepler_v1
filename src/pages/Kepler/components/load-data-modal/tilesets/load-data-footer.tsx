// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// Localized presentation adapted from the Kepler 3.2.0 Tileset footer.

import styled, {useTheme} from 'styled-components';
import {Button, LoadingSpinner} from '@kepler.gl/components';

const AddDataButton = styled(Button)`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  opacity: ${props => (props.disabled ? 0.6 : 1)};
  min-height: 40px;
  padding: 9px 20px;
  width: fit-content;
  min-width: 130px;
`;

const LoadDataFooterContainer = styled.div.attrs({className: 'load-data-footer'})`
  width: 100%;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  padding: 21px 21px 0px 72px;
  margin: 24px -72px 0;
  align-items: center;
`;

const ErrorContainer = styled.div`
  color: red;
  padding-left: 15px;
  display: inline-block;
`;

type LoadDataFooterProps = {
  disabled?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  errorText?: string | null;
};

export default function LoadDataFooter({
  disabled,
  isLoading,
  onConfirm,
  errorText
}: LoadDataFooterProps) {
  const theme = useTheme();
  return (
    <LoadDataFooterContainer>
      <div>
        <AddDataButton
          disabled={disabled}
          aria-busy={Boolean(isLoading)}
          onClick={onConfirm}
          cta
        >
          {isLoading && (
            <span aria-hidden="true">
              <LoadingSpinner color={theme.borderColorLT} borderColor="transparent" size={20} />
            </span>
          )}
          {isLoading ? 'Carregando...' : 'Adicionar conjunto'}
        </AddDataButton>
        {errorText && <ErrorContainer role="alert">{errorText}</ErrorContainer>}
      </div>
    </LoadDataFooterContainer>
  );
}
