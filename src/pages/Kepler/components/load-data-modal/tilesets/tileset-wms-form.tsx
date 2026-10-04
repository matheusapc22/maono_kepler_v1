// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// Presentation adapted from @kepler.gl/components 3.2.0. Native metadata
// loading, dataset construction, callbacks and validation are retained.

import React, {useCallback, useEffect, useState} from 'react';
import styled from 'styled-components';
import type {WMSCapabilities} from '@loaders.gl/wms';

import {validateUrl} from '@kepler.gl/common-utils';
import {DatasetType, REMOTE_TILE, RemoteTileFormat, type WMSDatasetMetadata} from '@kepler.gl/constants';
import {getWMSCapabilities, wmsCapabilitiesToDatasetMetadata} from '@kepler.gl/table';

import type {MetaResponse} from './common';
import {InputLight} from '@kepler.gl/components';

const TilesetInputContainer = styled.div`
  display: grid;
  grid-template-rows: repeat(3, auto);
  row-gap: 18px;
  font-size: 12px;
`;

const TilesetInputDescription = styled.div`
  text-align: center;
  color: ${props => props.theme.AZURE200};
  font-size: 11px;
`;

const ExampleUrlsContainer = styled.div`
  text-align: left;
  color: ${props => props.theme.AZURE200};
  font-size: 11px;

  .example-url {
    margin-top: 8px;
    display: block;
  }
`;

type WMSTileFormProps = {
  setResponse: (response: MetaResponse) => void;
};

type WMSData = {
  metadata: WMSCapabilities | null;
  layers: WMSDatasetMetadata['layers'];
  version: string;
};

const TilesetWMSForm: React.FC<WMSTileFormProps> = ({setResponse}) => {
  const [layerName, setLayerName] = useState<string>('');
  const [wmsUrl, setWmsUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [wmsData, setWMSData] = useState<WMSData | null>(null);

  const onLayerNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      setLayerName(event.target.value);
    },
    [setLayerName]
  );

  const onWmsUrlChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      const newWmsUrl = event.target.value;
      setWmsUrl(newWmsUrl);

      if (!validateUrl(newWmsUrl)) {
        setWMSData(null);
        return;
      }

      // Fetch WMS GetCapabilities
      try {
        setLoading(true);
        setError(null);

        const data = await getWMSCapabilities(newWmsUrl);

        const datasetMetadata = wmsCapabilitiesToDatasetMetadata(data);

        // Extract name or title from GetCapabilities response
        const serviceTitle = data?.title || data?.name;
        if (serviceTitle && !layerName) {
          setLayerName(serviceTitle);
        }

        setWMSData({
          metadata: data,
          layers: datasetMetadata.layers,
          version: datasetMetadata.version
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setWMSData(null);
      } finally {
        setLoading(false);
      }
    },
    [layerName]
  );

  useEffect(() => {
    if (layerName && wmsUrl) {
      const dataset = {
        name: layerName,
        type: DatasetType.WMS_TILE,
        metadata: {
          type: REMOTE_TILE,
          remoteTileFormat: RemoteTileFormat.WMS,
          tilesetDataUrl: wmsUrl,
          tilesetMetadataUrl: `${wmsUrl}?service=WMS&request=GetCapabilities`,
          layers: wmsData?.layers || [],
          wmsVersion: wmsData?.version || '1.3.0'
        }
      };
      setResponse({
        metadata: wmsData?.metadata ?? null,
        dataset,
        loading,
        error
      });
    } else {
      setResponse({
        metadata: null,
        dataset: null,
        loading,
        error
      });
    }
  }, [setResponse, layerName, wmsUrl, wmsData, loading, error]);

  return (
    <TilesetInputContainer>
      <div>
        <label htmlFor="layer-name">Nome</label>
        <InputLight
          id="layer-name"
          placeholder="Nome da camada WMS"
          value={layerName}
          onChange={onLayerNameChange}
        />
      </div>
      <div>
        <label htmlFor="wms-url">URL do serviço WMS</label>
        <InputLight
          id="wms-url"
          placeholder="Digite a URL do serviço WMS"
          value={wmsUrl}
          onChange={onWmsUrlChange}
        />
        <TilesetInputDescription>Informe uma URL válida de serviço WMS.</TilesetInputDescription>
      </div>
      <div>
        <TilesetInputDescription>Por exemplo, use uma URL pública de WMS:</TilesetInputDescription>
        <ExampleUrlsContainer>
          <div className="example-url">• https://ows.terrestris.de/osm/service</div>
          <div className="example-url">
            • https://opengeo.ncep.noaa.gov/geoserver/conus/conus_cref_qcd/ows
          </div>
          <div className="example-url">
            • https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi
          </div>
        </ExampleUrlsContainer>
      </div>
    </TilesetInputContainer>
  );
};

export default TilesetWMSForm;
