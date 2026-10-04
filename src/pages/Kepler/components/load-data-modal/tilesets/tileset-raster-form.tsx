// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// Presentation adapted from @kepler.gl/components 3.2.0. Native metadata
// loading, dataset construction, callbacks and validation are retained.

import React, {useCallback, useEffect, useState} from 'react';
import styled from 'styled-components';

import type {PMTilesMetadata} from '@loaders.gl/pmtiles';

import {isPMTilesUrl, validateUrl} from '@kepler.gl/common-utils';
import {RasterTileType, PMTilesType} from '@kepler.gl/constants';
import type {JsonObjectOrArray} from '@kepler.gl/types';
import {parseRasterMetadata, parseVectorMetadata} from '@kepler.gl/table';
import {getApplicationConfig} from '@kepler.gl/utils';
import {getDatasetAttributesFromRasterTile} from '@kepler.gl/components/dist/modals/tilesets-modals/tileset-raster-form';

import {default as useFetchJson} from '@kepler.gl/components/dist/hooks/use-fetch-raster-tile-metadata';
import type {MetaResponse} from './common';
import {InputLight} from '@kepler.gl/components';

const TilesetInputContainer = styled.div`
  display: grid;
  grid-template-rows: repeat(3, 1fr);
  row-gap: 0px;
  font-size: 12px;
`;

const TilesetInputDescription = styled.div`
  text-align: center;
  color: ${props => props.theme.AZURE200};
  font-size: 11px;
`;

const LabelRow = styled.div`
  display: flex;
  align-items: center;
`;

type RasterTileFormProps = {
  setResponse: (response: MetaResponse) => void;
};

const parseMetadataAllowCollections = (
  metadata: JsonObjectOrArray | PMTilesMetadata,
  {metadataUrl, rasterTileType}: {metadataUrl: string; rasterTileType: RasterTileType}
) => {
  return rasterTileType === RasterTileType.PMTILES
    ? parseVectorMetadata(metadata as PMTilesMetadata, {
        tileUrl: metadataUrl
      })
    : parseRasterMetadata(metadata as JsonObjectOrArray, {allowCollections: true});
};

const RasterTileForm: React.FC<RasterTileFormProps> = ({setResponse}) => {
  const [tileName, setTileName] = useState<string>('');
  const [tileNameWasModified, setTileNameWasModified] = useState<boolean>(false);
  const [metadataUrl, setMetadataUrl] = useState<string>('');
  const [rasterTileServerUrls, setRasterTileServerUrls] = useState<string>(
    (getApplicationConfig().rasterServerUrls || []).join(',')
  );

  // Remove trailing slash to prevent issues with raster tile servers
  const clearedMetadataUrl = metadataUrl.endsWith('/') ? metadataUrl.slice(0, -1) : metadataUrl;

  const onTileNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      setTileNameWasModified(true);
      setTileName(event.target.value);
    },
    [setTileName]
  );

  const onMetadataUrlChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      const {value} = event.target;
      setMetadataUrl(value);

      if (!tileNameWasModified) {
        setTileName(value.split('/').filter(Boolean).pop() || '');
      }
    },
    [tileNameWasModified]
  );

  const onRasterTileServerUrlsChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      setRasterTileServerUrls(event.target.value);
    },
    [setRasterTileServerUrls]
  );

  const {
    data: metadata,
    loading,
    error: metaError
  } = useFetchJson({
    url: clearedMetadataUrl,
    rasterTileType: isPMTilesUrl(clearedMetadataUrl) ? RasterTileType.PMTILES : RasterTileType.STAC,
    process: parseMetadataAllowCollections
  });

  useEffect(() => {
    if (tileName && clearedMetadataUrl) {
      const pmtilesType = metadata?.pmtilesType;

      if (pmtilesType === PMTilesType.MVT) {
        return setResponse({
          metadata,
          dataset: null,
          loading,
          error: new Error('For .pmtiles in mvt format, please use the Vector Tile form.')
        });
      }

      let error = metaError;

      // check for raster tile servers for STAC items and collections
      let rasterTileServers;
      if (
        !error
        // We still need raster tile servers for PMTiles when we plan to use elevation
      ) {
        rasterTileServers = rasterTileServerUrls
          .split(',')
          .map(server => server.trim())
          .filter(server => server);
        if (
          rasterTileServers.length < 1 ||
          !rasterTileServers.every(server => validateUrl(server))
        ) {
          if (pmtilesType) {
            // For raster tiles elevation support is optional
            // TODO display a warning, but not a blocking error
            rasterTileServers = [];
          } else {
            error = new Error(
              'Provide valid raster tile server urls to support STAC and elevations.'
            );
          }
        }
      }

      const dataset = getDatasetAttributesFromRasterTile({
        name: tileName,
        metadataUrl: clearedMetadataUrl,
        rasterTileServerUrls: rasterTileServers
      });

      setResponse({
        metadata,
        dataset,
        loading,
        error
      });
    } else {
      setResponse({
        metadata,
        dataset: null,
        loading,
        error: metaError
      });
    }
  }, [
    metadata,
    loading,
    metaError,
    tileName,
    clearedMetadataUrl,
    rasterTileServerUrls,
    setResponse
  ]);

  const showServerInput = getApplicationConfig().rasterServerShowServerInput;

  return (
    <TilesetInputContainer>
      <div>
        <label htmlFor="tileset-name">Nome</label>
        <InputLight
          id="tileset-name"
          placeholder="Nome do conjunto de blocos"
          value={tileName}
          onChange={onTileNameChange}
        />
      </div>
      <div>
        <LabelRow>
          <label htmlFor="tile-metadata">URL dos metadados</label>
        </LabelRow>
        <InputLight
          id="tile-metadata"
          placeholder="URL dos metadados"
          value={metadataUrl ?? undefined}
          onChange={onMetadataUrlChange}
        />
        <TilesetInputDescription>
          Aceita .pmtiles matriciais. Suporte limitado a itens e coleções STAC.
        </TilesetInputDescription>
      </div>
      {showServerInput && (
        <div>
          <LabelRow>
            <label htmlFor="tileset-raster-servers">Servidores de blocos matriciais</label>
          </LabelRow>
          <InputLight
            id="tileset-raster-servers"
            placeholder="URLs dos servidores, separadas por vírgulas"
            value={rasterTileServerUrls}
            onChange={onRasterTileServerUrlsChange}
          />
          <TilesetInputDescription>
            URLs dos servidores de blocos matriciais para conjuntos Cloud Optimized GeoTIFF e elevação.
          </TilesetInputDescription>
        </div>
      )}
    </TilesetInputContainer>
  );
};

export default RasterTileForm;
