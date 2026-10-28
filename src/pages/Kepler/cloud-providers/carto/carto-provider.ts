// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import { OAuthApp } from "@carto/toolkit";
import Console from "global/console";
import CartoIcon from "./carto-icon";
import { Provider } from "@kepler.gl/cloud-providers";
import { createDataContainer } from "@kepler.gl/utils";
import { formatCsv } from "@kepler.gl/reducers";
import type { MapData, ExportFileOptions, SavedDatasetV1 } from "@kepler.gl/types";

// Keep the actual SDK prototype, while declaring only the members inherited
// unchanged. Legacy CSV/share receipts differ from the SDK's saved-map types.
const CartoProviderBase: new (...args: ConstructorParameters<typeof Provider>) =>
  Pick<Provider, "name" | "displayName" | "storageMessage" | "icon" | "thumbnail" | "isNew" | "getFileConflictError"> = Provider;

type CartoMap = {
  id: string; name: string; description: string | null; thumbnail: string | null;
  isprivate: boolean; config: string; lastmodified: string;
};
type CartoMapParams = { mapId: string; owner: string | null; privateMap: boolean | string };
type CartoDownloadParams = { owner?: string; mapId?: string; privateMap?: boolean | string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVisualization(value: unknown): value is CartoMap {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.name === "string" && (value.description === null || typeof value.description === "string") &&
    (value.thumbnail === null || typeof value.thumbnail === "string") &&
    typeof value.isprivate === "boolean" && typeof value.config === "string" &&
    typeof value.lastmodified === "string";
}

function readVisualization(value: unknown): CartoMap {
  if (!isVisualization(value)) {
    throw new Error("Invalid CARTO visualization response");
  }
  return value;
}

function readPrivacy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw new Error("Invalid CARTO map privacy flag");
}

function createToolkitApp(): OAuthApp {
  // The installed toolkit accepts string scopes and merges partial AppOptions in its
  // implementation. Its declaration instead requires scopes?: '' and every
  // option. Check the actual constructed instance; do not cast those arguments.
  const app: unknown = Reflect.construct(OAuthApp, [
    { authorization: `https://${DOMAIN}/oauth2`, scopes: "schemas:c datasets:rw:*" },
    { serverUrlTemplate: `https://{user}.${DOMAIN}/`, namespace: NAMESPACE },
  ]);
  if (!(app instanceof OAuthApp)) throw new Error("Invalid CARTO toolkit instance");
  return app;
}

const NAME = "carto";
const DISPLAY_NAME = "CARTO";
const NAMESPACE = "keplergl";
const DOMAIN = "carto.com";
const PRIVATE_STORAGE_ENABLED = true;
const SHARING_ENABLED = true;

export default class CartoProvider extends CartoProviderBase {
  clientId: string | undefined;
  currentMap: CartoMap | null;
  _folderLink: string;
  _carto: OAuthApp;

  constructor(clientId: string | undefined) {
    super({ name: NAME, displayName: DISPLAY_NAME, icon: CartoIcon });

    this.clientId = clientId;
    this.thumbnail = { width: 300, height: 200 };
    this.currentMap = null;

    this._folderLink = `https://{user}.${DOMAIN}/dashboard/maps/external`;

    // Initialize CARTO API
    this._carto = createToolkitApp();
    // The toolkit's implementation treats undefined as a no-op.
    if (clientId !== undefined) this._carto.setClientID(clientId);
  }

  /**
   * The CARTO toolkit library takes care of the login process.
   */
  async login(onCloudLoginSuccess?: (name: string) => void) {
    try {
      await this._carto.login();
      if (onCloudLoginSuccess) onCloudLoginSuccess(this.name);
      return await this.getUser();
    } catch (error) {
      this._manageErrors(error);
    }
  }

  async logout(onCloudLogoutSuccess?: () => void) {
    try {
      this._carto.oauth.clear();
      // Public accessor returns the same provider used internally by OAuth.
      this._carto.oauth.client.provider("carto").sync();
      onCloudLogoutSuccess?.();
    } catch (error) {
      this._manageErrors(error);
    }
  }

  isEnabled() {
    return this.clientId !== null;
  }

  hasPrivateStorage() {
    return PRIVATE_STORAGE_ENABLED;
  }

  hasSharingUrl() {
    return SHARING_ENABLED;
  }

  async uploadMap({ mapData, options = {} }: { mapData?: MapData; options?: ExportFileOptions }) {
    try {
      const { isPublic = true, overwrite = true } = options;
      if (!mapData?.map || !Array.isArray(mapData.map.datasets) ||
          !mapData.map.info || typeof mapData.map.info.title !== "string" ||
          typeof mapData.map.info.description !== "string" || !isRecord(mapData.map.config)) {
        throw new Error("Invalid CARTO map data");
      }
      const { map: { config, datasets, info }, thumbnail } = mapData;
      const currentMap = this.currentMap;
      if (overwrite && !currentMap) throw new Error("No current CARTO map to overwrite");
      const owner = this._carto.username;
      if (!owner) throw new Error("No authenticated CARTO map owner");

      const cartoDatasets = datasets.map(this._convertDataset);

      const cs = await this._carto.getCustomStorage();

      const { title, description } = info;
      const name = title;

      const thumbnailBase64 =
        mapData && thumbnail
          ? await this._blobToBase64(thumbnail)
          : null;

      // SQLStorage derives lastmodified server-side and accepts a null
      // thumbnail. Validate its receipt instead of inventing those input fields.
      let rawResult: unknown;
      if (overwrite && currentMap) {
        rawResult = await Reflect.apply(cs.updateVisualization, cs, [
          {
            id: currentMap.id,
            name,
            description,
            thumbnail: thumbnailBase64,
            config: JSON.stringify(config),
            isprivate: currentMap.isprivate,
          },
          cartoDatasets,
        ]);
      } else {
        // TODO: Ask for changing current shared map generation because of being too oriented to file based clouds
        // Check public name generation and replace
        const regex = /(?:^keplergl_)([a-z0-9]+)(?:.json$)/;
        const capturedName = name.match(regex);
        const visName = capturedName ? `sharedmap_${capturedName[1]}` : name;

        rawResult = await Reflect.apply(cs.createVisualization, cs, [
          {
            name: visName,
            description,
            thumbnail: thumbnailBase64,
            config: JSON.stringify(config),
            isprivate: !isPublic,
          },
          cartoDatasets,
          true,
        ]);
      }

      const result = readVisualization(rawResult);
      this.currentMap = result;

      return {
        shareUrl: this._getMapPermalinkFromParams(
          {
            mapId: result.id,
            owner,
            privateMap: result.isprivate,
          },
          true
        ),
        folderLink: this._folderLink.replace("{user}", owner),
      };
    } catch (error) {
      this._manageErrors(error);
    }
  }

  /**
   * Returns the access token. If it has expired returns null. The toolkit library loads it
   * from localStorage automatically
   */
  async getAccessToken() {
    let accessToken = null;
    try {
      accessToken = this._carto.oauth.expired ? null : this._carto.oauth.token;
    } catch (error) {
      this._manageErrors(error, false);
    }

    return accessToken;
  }

  getUserName() {
    let username = null;
    try {
      username = this._carto.oauth.expired ? null : this._carto.username;
    } catch (error) {
      this._manageErrors(error, false);
    }

    return username;
  }

  /**
   * The CARTO cloud provider polls the created window internally to parse the URL
   * @param {*} location
   */
  getAccessTokenFromLocation() {
    return;
  }

  async getUser() {
    return {
      name: this.getUserName(),
      abbreviated: "",
      email: "",
    };
  }

  async downloadMap(queryParams: CartoDownloadParams) {
    try {
      const { owner: username, mapId, privateMap } = queryParams;

      if (!username || !mapId) {
        return;
      }

      let visualization;

      if (readPrivacy(privateMap)) {
        await this._carto.login();
        const currentUsername = this.getUserName();
        if (currentUsername && currentUsername === username) {
          const cs = await this._carto.getCustomStorage();
          visualization = await cs.getVisualization(mapId);
        }
      } else {
        visualization = await this._carto.PublicStorageReader.getVisualization(
          username,
          mapId
        );
      }

      if (!visualization) {
        throw new Error(`Can't find map with ID: ${mapId}`);
      }

      // These are the options required for the action. For now, all datasets that come from CARTO are CSV
      const datasets = visualization.datasets.map((dataset) => {
        const datasetId = dataset.name;

        return {
          info: {
            id: datasetId,
            label: datasetId,
            description: "description" in dataset && typeof dataset.description === "string" ? dataset.description : undefined,
            dataUrl: "",
            configUrl: "",
            panelDisabled: true,
          },
          data: dataset.file,
        };
      });

      // const datasets = visualization.datasets.map(dataset => dataset.file);

      this.currentMap = readVisualization(visualization.vis);

      return {
        map: {
          datasets,
          config: visualization.vis.config,
          info: {
            title: visualization.vis.name,
            description: visualization.vis.description,
          },
        },
        format: "csv",
      };
    } catch (error) {
      this._manageErrors(error);
    }
  }

  async listMaps() {
    // TODO: Implement pagination using {type='all', pageOffset=0, pageSize=-1}
    try {
      await this._carto.login();
      const username = this.getUserName();
      const cs = await this._carto.getCustomStorage();

      const visualizations = await cs.getVisualizations();
      let formattedVis = [];

      // Format visualization object
      for (const vis of visualizations) {
        formattedVis.push({
          id: vis.id,
          title: vis.name,
          description: vis.description,
          privateMap: vis.isprivate,
          thumbnail: vis.thumbnail === "undefined" ? null : vis.thumbnail,
          lastModification: new Date(Date.parse(vis.lastmodified)),
          loadParams: {
            owner: username,
            mapId: vis.id,
            privateMap: vis.isprivate.toString(),
          },
        });
      }

      formattedVis = formattedVis.sort(
        (a, b) => b.lastModification.getTime() - a.lastModification.getTime()
      );

      return formattedVis;
    } catch (error) {
      this._manageErrors(error);
    }
  }

  getShareUrl(fullUrl = false) {
    return this.getMapUrl(fullUrl);
  }

  getMapUrl(fullUrlOrParams: boolean | CartoMapParams = true, mapParams: CartoMapParams | null = null) {
    const fullUrl = typeof fullUrlOrParams === "boolean" ? fullUrlOrParams : true;
    const params = typeof fullUrlOrParams === "object" ? fullUrlOrParams : mapParams;
    if (params) {
      return this._getMapPermalinkFromParams(params, fullUrl);
    } else if (this.currentMap) {
      return this._getMapPermalinkFromParams(
        {
          mapId: this.currentMap.id,
          owner: this.getUserName(),
          privateMap: this.currentMap.isprivate,
        },
        fullUrl
      );
    }
  }

  getManagementUrl() {
    const owner = this._carto.username;
    return owner ? this._folderLink.replace("{user}", owner) : "";
  }

  getCurrentVisualization() {
    return this.currentMap
      ? {
          title: this.currentMap.name,
          description: this.currentMap.description,
        }
      : null;
  }

  // PRIVATE

  _getMapPermalinkFromParams({ mapId, owner, privateMap }: CartoMapParams, fullURL = true) {
    const mapLink = this._composeURL({ mapId, owner, privateMap });
    return fullURL
      ? `${window.location.protocol}//${window.location.host}/${mapLink}`
      : `/${mapLink}`;
  }

  _convertDataset({ data: dataset }: SavedDatasetV1) {
    const { allData, fields, id } = dataset;
    const columns = fields.map((field) => {
      if (!field) throw new Error("Invalid CARTO dataset field");
      return { name: field.name, type: field.type };
    });

    const dataContainer = createDataContainer([...allData]);

    // SavedDatasetV1 keeps serialized fields; the real formatter consumes
    // their name/type/format. Its declaration unnecessarily requires Field[].
    const file: unknown = Reflect.apply(formatCsv, undefined, [dataContainer, fields]);
    if (typeof file !== "string") throw new Error("Invalid CARTO dataset CSV");

    return {
      name: id,
      columns,
      file,
    };
  }

  _manageErrors(error: unknown, throwException?: true): never;
  _manageErrors(error: unknown, throwException: false): void;
  _manageErrors(error: unknown, throwException = true): void {
    let message;
    if (isRecord(error) && typeof error.message === "string") {
      message = error.message;

      switch (message) {
        case "No client ID has been specified":
          Console.error("No ClientID set for CARTO provider");
          break;
        case "Cannot set the client ID more than once":
          Console.error("CARTO provider already initialized");
          break;
        case (
          message.match(/relation "[a-zA-Z0-9_]+" does not exist/) || {}
        ).input:
          Console.error("CARTO custom storage is not properly initialized");
          message = "Custom storage is not properly initialized";
          break;
        case (
          message.match(
            /Failed to copy to keplergl_[a-zA-Z0-9_]+: Too many retries/
          ) || {}
        ).input:
          Console.error("CARTO Rate limit exceeded");
          message =
            "Failed to upload. You've exceeded the number of datasets allowed with your plan. Consider upgrading your plan.";
          break;
        case (message.match(/[a-zA-Z0-9_\s:]+: DB Quota exceeded/) || {})
          .input:
          Console.error("CARTO DB Quota exceeded");
          message =
            "Failed to upload. You've exceeded your account's disk storage limit. Consider upgrading your plan.";
          break;
        default:
          // OAuth/storage errors may contain credentials or private SQL.
          Console.error("CARTO provider operation failed");
      }
    } else {
      message = "General error in CARTO provider";
      Console.error(message);
    }

    // Use 'CARTO' as error code in order to show provider in notifications
    if (throwException) {
      throw new Error(message);
    }
  }

  _composeURL({ mapId, owner, privateMap }: CartoMapParams) {
    return `demo/map/carto?mapId=${encodeURIComponent(mapId)}&owner=${encodeURIComponent(owner ?? "")}&privateMap=${readPrivacy(privateMap)}`;
  }

  _blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.error) {
          reject(reader.error);
        } else if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("Invalid CARTO thumbnail data URL"));
        }
      };
      reader.readAsDataURL(blob);
    });
  }
}
