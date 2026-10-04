// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// Presentation adapted from @kepler.gl/components 3.2.0. Native metadata
// loading, dataset construction, callbacks and validation are retained.

import React, {useCallback, useEffect, useState, useMemo} from 'react';
import styled from 'styled-components';

import {isPMTilesUrl} from '@kepler.gl/common-utils';
import {
  PMTilesType,
  RemoteTileFormat
} from '@kepler.gl/constants';
import type {TileJSON} from '@loaders.gl/mvt';
import type {PMTilesMetadata} from '@loaders.gl/pmtiles';
import {getMetaUrl, parseVectorMetadata, type VectorTileMetadata} from '@kepler.gl/table';
import {getDatasetAttributesFromVectorTile} from '@kepler.gl/components/dist/modals/tilesets-modals/tileset-vector-form';

import {default as useFetchVectorTileMetadata} from '@kepler.gl/components/dist/hooks/use-fetch-vector-tile-metadata';
import type {MetaResponse} from './common';
import {InputLight} from '@kepler.gl/components';

const TilesetInputContainer = styled.div`
  display: grid;
  grid-template-rows: repeat(3, 1fr);
  row-gap: 18px;
  font-size: 12px;
`;

const TilesetInputDescription = styled.div`
  text-align: center;
  color: ${props => props.theme.AZURE200};
  font-size: 11px;
`;

type TilesetVectorFormProps = {
  setResponse: (response: MetaResponse) => void;
};

const TilesetVectorForm: React.FC<TilesetVectorFormProps> = ({setResponse}) => {
  const [tileName, setTileName] = useState<string>('');
  const [tileUrl, setTileUrl] = useState<string>('');
  const [metadataUrl, setMetadataUrl] = useState<string | null>('');
  const [initialFetchError, setInitialFetchError] = useState<Error | null>(null);

  const onTileNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      setTileName(event.target.value);
    },
    [setTileName]
  );

  const onTileMetaUrlChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      setMetadataUrl(event.target.value);
    },
    [setMetadataUrl]
  );

  const onTileUrlChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      const newTileUrl = event.target.value;
      setTileUrl(newTileUrl);

      const usePMTiles = isPMTilesUrl(newTileUrl);
      const potentialMetadataUrl = usePMTiles ? newTileUrl : getMetaUrl(newTileUrl);
      if (!metadataUrl && potentialMetadataUrl) {
        // check if URL exists before setting it as the metadata URL
        // Note: The {method: HEAD} request often fails, likely due to individual storage settings.
        const resp = usePMTiles ? ({ok: true} as Response) : await fetch(potentialMetadataUrl);
        if (resp.ok) {
          setInitialFetchError(null);
          setMetadataUrl(potentialMetadataUrl);
        } else {
          setInitialFetchError(
            new Error(`Metadata loading failed: ${resp.status} ${resp.statusText}`)
          );
        }
      } else {
        setInitialFetchError(null);
      }
      if (!tileName) {
        setTileName(newTileUrl.split('/').pop() || newTileUrl);
      }
    },
    [setTileUrl, tileName, setMetadataUrl, metadataUrl]
  );

  const process = useMemo(() => {
    return (value: PMTilesMetadata | TileJSON) =>
      parseVectorMetadata(value, {tileUrl: metadataUrl});
  }, [metadataUrl]);

  const {
    data: metadata,
    loading,
    error: metaError
  } = useFetchVectorTileMetadata({
    metadataUrl,
    tilesetUrl: tileUrl,
    remoteTileFormat: isPMTilesUrl(metadataUrl) ? RemoteTileFormat.PMTILES : RemoteTileFormat.MVT,
    process
  });

  // reset initial fetch error if the metadata is available
  if (metadata && initialFetchError) {
    setInitialFetchError(null);
  }

  useEffect(() => {
    if (tileName && tileUrl) {
      if (metadata?.pmtilesType === PMTilesType.RASTER) {
        return setResponse({
          metadata,
          dataset: null,
          loading,
          error: new Error('For .pmtiles in raster format, please use the Raster Tile form.')
        });
      }

      const dataset = getDatasetAttributesFromVectorTile({
        name: tileName,
        dataUrl: tileUrl,
        metadataUrl: metadataUrl ?? undefined
      });
      setResponse({
        metadata,
        dataset,
        loading,
        error: metaError || initialFetchError
      });
    } else {
      setResponse({
        metadata,
        dataset: null,
        loading,
        error: metaError || initialFetchError
      });
    }
  }, [
    setResponse,
    metadata,
    loading,
    metaError,
    initialFetchError,
    tileUrl,
    tileName,
    metadataUrl
  ]);

  useEffect(() => {
    if (metadata) {
      const name = (metadata as VectorTileMetadata).name;
      if (name) {
        setTileName(name);
      }
    }
  }, [metadata]);

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
        <label htmlFor="tile-url">URL do conjunto de blocos</label>
        <InputLight
          id="tile-url"
          placeholder="URL do conjunto de blocos"
          value={tileUrl}
          onChange={onTileUrlChange}
        />
        <TilesetInputDescription>
          Requer os marcadores &#123;x&#125;, &#123;y&#125; e &#123;z&#125; na URL ou a
          extensão .pmtiles.
        </TilesetInputDescription>
      </div>
      <div>
        <label htmlFor="tile-metadata">URL dos metadados</label>
        <InputLight
          id="tile-metadata"
          placeholder="URL dos metadados"
          value={metadataUrl ?? undefined}
          onChange={onTileMetaUrlChange}
        />
        <TilesetInputDescription>
          Opcional, mas recomendado. Aceita json e txt.
        </TilesetInputDescription>
      </div>
    </TilesetInputContainer>
  );
};

export default TilesetVectorForm;
