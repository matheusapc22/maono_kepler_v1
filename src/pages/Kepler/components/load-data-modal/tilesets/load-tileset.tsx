// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// Portuguese presentation adapted from @kepler.gl/components 3.2.0.
// Metadata and native onTilesetAdded arguments are passed through unchanged.

import React, {useCallback, useMemo, useState} from 'react';
import type NativeLoadTilesetTabFactory from '@kepler.gl/components/dist/modals/tilesets-modals/load-tileset';
import JSONPretty from 'react-json-pretty';
import {AutoSizer} from 'react-virtualized';
import styled from 'styled-components';

import {VectorTileIcon, RasterTileIcon, WMSLayerIcon} from '@kepler.gl/layers';
import {getError, getApplicationConfig} from '@kepler.gl/utils';

import type {MetaResponse} from './common';
import {localizeTilesetError} from './localize-tileset-error';
import LoadDataFooter from './load-data-footer';
import TilesetIcon from '@kepler.gl/components/dist/modals/tilesets-modals/tileset-icon';
import TilesetVectorForm from './tileset-vector-form';
import TilesetRasterForm from './tileset-raster-form';

import TilesetWMSForm from './tileset-wms-form';

const WIDTH_ICON = '70px';

const LoadTilesetTabContainer = styled.div`
  color: ${props => props.theme.AZURE};
`;

const Container = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-gap: 20px;
  background-color: ${props => props.theme.WHITE};
`;

const TilesetTypeContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(4, ${WIDTH_ICON});
  column-gap: 10px;
  margin-bottom: 20px;
`;

const MetaContainer = styled.div`
  display: flex;
  max-height: 400px;
  background-color: ${({theme}) => theme.editorBackground};
`;

export interface MetaInnerContainerProps {
  width: number;
  height: number;
}

const MetaInnerContainer = styled.div<MetaInnerContainerProps>`
  position: relative;
  border: 1px solid ${props => props.theme.selectBorderColorLT};
  background-color: ${props => props.theme.panelBackgroundLT};
  border-radius: 2px;
  display: inline-block;
  font: inherit;
  line-height: 1.5em;
  padding: 0.5em 3.5em 0.5em 1em;
  box-sizing: border-box;
  overflow-y: scroll;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  height: ${props => props.height}px;
  width: ${props => props.width}px;
  color: ${props => props.theme.textColorLT};
  font-size: 11px;
  font-family: ${props => props.theme.fontFamily};
  max-width: 600px;
`;

const StyledHeaderMessage = styled.div`
  color: ${props => props.theme.textColorLT};
  font-size: 14px;
`;

type LoadTilesetTabProps = React.ComponentProps<ReturnType<typeof NativeLoadTilesetTabFactory>>;

const TILE_TYPES = [
  {
    id: 'vectorTile',
    label: 'Vetorial',
    Icon: VectorTileIcon,
    Component: TilesetVectorForm
  },
  {
    id: 'rasterTile',
    label: 'Matricial',
    Icon: RasterTileIcon,
    Component: TilesetRasterForm
  },
  {
    id: 'wms',
    label: 'WMS',
    Icon: WMSLayerIcon,
    Component: TilesetWMSForm
  }
];

function isReady(response: MetaResponse) {
  return response.dataset && !response.loading && !response.error;
}

const LocalizedLoadTilesetTab: React.FC<LoadTilesetTabProps> = ({onTilesetAdded, isAddingDatasets}) => {
  const [typeIndex, setTypeIndex] = useState<number>(0);
  const [response, setResponse] = useState<MetaResponse>({});

  const error = response.error;
  const loading = response.loading;
  const data = response.metadata;
  const jsonDataText = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const createTileDataset = useCallback(() => {
    const {dataset, metadata} = response;
    if (dataset) {
      onTilesetAdded(dataset, metadata);
    }
  }, [onTilesetAdded, response]);

  // temp patch to hide raster tile layer while in development
  const enableRasterTileLayer = getApplicationConfig().enableRasterTileLayer;
  const enableWMSLayer = getApplicationConfig().enableWMSLayer;

  // Filter tile types based on application config
  const tileTypes = useMemo(() => {
    const types = TILE_TYPES.filter(tileType => {
      if (tileType.id === 'rasterTile') {
        return enableRasterTileLayer;
      }
      if (tileType.id === 'wms') {
        return enableWMSLayer;
      }
      return true; // Include all other types by default
    });
    return types;
  }, [enableRasterTileLayer, enableWMSLayer]);

  const CurrentForm = tileTypes[typeIndex].Component;

  return (
    <LoadTilesetTabContainer>
      <Container>
        <div>
          <StyledHeaderMessage>Tipo de conjunto</StyledHeaderMessage>

          <TilesetTypeContainer className="tileset-type">
            {tileTypes.map((tileType, index) => (
              <TilesetIcon
                key={tileType.label}
                name={tileType.label}
                Icon={<tileType.Icon height={WIDTH_ICON} />}
                onClick={() => setTypeIndex(index)}
                selected={typeIndex === index}
              />
            ))}
          </TilesetTypeContainer>
          <div>
            <CurrentForm setResponse={setResponse} />
          </div>
        </div>
        <MetaContainer>
          {data && (
            <AutoSizer>
              {({height, width}) => (
                <MetaInnerContainer height={height} width={width}>
                  <JSONPretty id="json-pretty" json={jsonDataText} />
                </MetaInnerContainer>
              )}
            </AutoSizer>
          )}
        </MetaContainer>
      </Container>
      <LoadDataFooter
        disabled={Boolean(error) || !isReady(response)}
        isLoading={loading || isAddingDatasets}
        onConfirm={createTileDataset}
        errorText={localizeTilesetError(error && getError(error))}
      />
    </LoadTilesetTabContainer>
  );
};

export default LocalizedLoadTilesetTab;
