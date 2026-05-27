// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

// Dropbox SDK (UMD build)
import * as DropboxSDK from "dropbox";
const DropboxCtor: any = (DropboxSDK as any).Dropbox ?? (DropboxSDK as any);

import Window from "global/window";
import DropboxIcon from "./dropbox-icon";
import { MAP_URI } from "../../constants/default-settings";
import { KEPLER_FORMAT, Provider } from "@kepler.gl/cloud-providers";

const NAME = "dropbox";
const DISPLAY_NAME = "Dropbox";
const DOMAIN = "www.dropbox.com";
const KEPLER_DROPBOX_FOLDER_LINK = `//${DOMAIN}/home/Apps`;
const CORS_FREE_DOMAIN = "dl.dropboxusercontent.com";
const PRIVATE_STORAGE_ENABLED = true;
const SHARING_ENABLED = true;
const MAX_THUMBNAIL_BATCH = 25;
const IMAGE_URL_PREFIX = "data:image/png;base64,";

function parseQueryString(query: string) {
  const searchParams = new URLSearchParams(query);
  const params: Record<string, string> = {};
  for (const p of searchParams) {
    if (p && p.length === 2 && p[0]) params[p[0]] = p[1];
  }
  return params;
}

function isConfigFile(err: any) {
  const summary = err?.error && err.error.error_summary;
  return (
    typeof summary === "string" &&
    Boolean(summary.match(/path\/conflict\/file\//g))
  );
}

function isDropboxPathNotFound(err: any) {
  const summary = err?.error?.error_summary || err?.error_summary || "";
  return typeof summary === "string" && summary.includes("path/not_found");
}

function getThumbnailPathFromMapPath(path: string) {
  return path.replace(/\.json$/i, ".png");
}

export default class DropboxProvider extends Provider {
  clientId: string | null;
  appName: string;
  _folderLink: string;
  _path: string;
  _dropbox: any;
  _shareUrl?: string;
  _cursor?: string;

  constructor(clientId: string | null, appName: string) {
    super({ name: NAME, displayName: DISPLAY_NAME, icon: DropboxIcon });
    this.clientId = clientId;
    this.appName = appName;

    this._folderLink = `${KEPLER_DROPBOX_FOLDER_LINK}/${appName}`;
    this._path = "";

    this._initializeDropbox();
  }

  /** OAuth flow in a popup; expects token to be posted back to opener. */
  async login() {
    return new Promise(async (resolve, reject) => {
      try {
        const link = await this._authLink();
        const authWindow = Window.open(link, "_blank", "width=1024,height=716");

        const handleToken = async (event: any) => {
          if (!event?.data?.token) return;

          if (authWindow) {
            authWindow.close();
            Window.removeEventListener("message", handleToken as any);
          }

          const { token } = event.data;
          if (!token) {
            reject("Failed to login to Dropbox");
            return;
          }

          this._dropbox.auth.setAccessToken(token);

          const user = await this.getUser();

          if (Window.localStorage) {
            Window.localStorage.setItem(
              "dropbox",
              JSON.stringify({
                token,
                user,
                timestamp: new Date(),
              })
            );
          }

          resolve(user);
        };

        Window.addEventListener("message", handleToken as any);
      } catch (e) {
        reject(e);
      }
    });
  }

  /** List maps (JSON + optional PNG thumbnails) from the app folder. */
  async listMaps() {
    try {
      const response = await this._dropbox.filesListFolder({
        path: `${this._path}`,
      });
      const { pngs, visualizations } = this._parseEntries(response);

      const thumbnails = await Promise.all(
        this._getThumbnailRequests(pngs)
      ).then((results) =>
        results.reduce(
          (accu: any[], r: any) => [...accu, ...(r.entries || [])],
          []
        )
      );

      (thumbnails || []).forEach((thb: any) => {
        if (thb[".tag"] === "success" && thb.thumbnail) {
          const matchViz =
            visualizations[pngs[thb.metadata.id] && pngs[thb.metadata.id].name];
          if (matchViz) {
            matchViz.thumbnail = `${IMAGE_URL_PREFIX}${thb.thumbnail}`;
            matchViz.thumbnailPath = pngs[thb.metadata.id].path_lower;
            matchViz.thumbnailUpdatedAt = pngs[thb.metadata.id].clientModified;
          }
        }
      });

      return Object.values(visualizations).reverse();
    } catch (error) {
      throw this._handleDropboxError(error);
    }
  }

  /**
   * Upload a map JSON and replace its PNG preview.
   *
   * Maõno Maps policy:
   * - The project JSON is kept as a single canonical file and is overwritten on save.
   * - The preview image is also kept as a single canonical PNG next to the JSON.
   * - Before writing the new PNG, the previous visible PNG is removed to avoid accumulating images.
   *
   * Example:
   *   /Projeto_MRA_v1.json
   *   /Projeto_MRA_v1.png
   */
  async uploadMap({ mapData, options = {} }: any) {
    const { isPublic } = options;
    const { map, thumbnail } = mapData;

    const name = map?.info && map.info.title;
    const fileName = `${name}.json`;
    const fileContent = map;

    // Always overwrite the canonical JSON for private saves.
    // This prevents Dropbox from creating Project (1).json, Project (2).json, etc.
    const mode = "overwrite";
    const path = `${this._path}/${fileName}`;

    let metadata: any;
    try {
      metadata = await this._dropbox.filesUpload({
        path,
        contents: JSON.stringify(fileContent),
        mode,
      });
    } catch (err) {
      if (isConfigFile(err)) {
        throw this.getFileConflictError();
      }
      throw err;
    }

    if (thumbnail) {
      await this.replaceThumbnailForMapPath(path, thumbnail);
    }

    if (isPublic) {
      return await this._shareFile(metadata);
    }

    return { id: metadata.id, path: metadata.path_lower };
  }

  /** Replace only the PNG preview for an existing map, without touching the JSON. */
  async replaceThumbnailForMapPath(mapPath: string, thumbnail: Blob) {
    const thumbnailPath = getThumbnailPathFromMapPath(mapPath);

    await this._deleteFileIfExists(thumbnailPath);

    return await this._dropbox.filesUpload({
      path: thumbnailPath,
      contents: thumbnail,
      mode: "overwrite",
    });
  }

  /** Download a map JSON. */
  async downloadMap(loadParams: any) {
    const { path } = loadParams;
    const result = await this._dropbox.filesDownload({ path });
    const json = await this._readFile(result.fileBlob);

    return Promise.resolve({
      map: json,
      format: KEPLER_FORMAT,
    });
  }

  getUserName() {
    if (Window.localStorage) {
      const jsonString = Window.localStorage.getItem("dropbox");
      return jsonString && JSON.parse(jsonString).user;
    }
    return null;
  }

  async logout() {
    try {
      await this._dropbox.authTokenRevoke();
    } catch {
      // ignore revoke failure
    }
    if (Window.localStorage) {
      Window.localStorage.removeItem("dropbox");
    }
    this._initializeDropbox();
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

  /** Public share URL for the last shared map. */
  getShareUrl(fullUrl = true) {
    return fullUrl
      ? `${Window.location.protocol}//${Window.location.host}/${MAP_URI}${this._shareUrl}`
      : `/${MAP_URI}${this._shareUrl}`;
  }

  /** Private map URL (path in Dropbox). */
  getMapUrl(loadParams: any) {
    const { path } = loadParams;
    return path;
  }

  getManagementUrl() {
    return this._folderLink;
  }

  /** Current token; load from localStorage if present. */
  getAccessToken() {
    let token = this._dropbox.auth.getAccessToken();
    if (!token && Window.localStorage) {
      const jsonString = Window.localStorage.getItem("dropbox");
      token = jsonString && JSON.parse(jsonString).token;
      if (token) {
        this._dropbox.auth.setAccessToken(token);
      }
    }
    return token || null;
  }

  /** Extract token from URL hash (#access_token=...). */
  getAccessTokenFromLocation(location: any) {
    if (!(location && location.hash?.length)) {
      return null;
    }
    const query = Window.location.hash.substring(1);
    return parseQueryString(query).access_token;
  }

  // ---------- PRIVATE ----------

  _initializeDropbox() {
    this._dropbox = new DropboxCtor({
      clientId: this.clientId,
      fetch: Window.fetch,
    });
  }

  async getUser() {
    const response = await this._dropbox.usersGetCurrentAccount();
    return this._getUserFromAccount(response);
  }

  _handleDropboxError(error: any) {
    if (error?.error?.error_summary) {
      return new Error(`Dropbox Error: ${error.error.error_summary}`);
    }
    return error;
  }

  _readFile(fileBlob: Blob) {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onload = ({ target }: any) => {
        try {
          const json = JSON.parse(target.result as string);
          resolve(json);
        } catch (err) {
          reject(err);
        }
      };
      fileReader.onerror = reject;
      fileReader.readAsText(fileBlob, "utf-8");
    });
  }

  _getMapPermalink(mapLink: string, fullUrl = true) {
    return fullUrl
      ? `${Window.location.protocol}//${Window.location.host}/${MAP_URI}${mapLink}`
      : `/${MAP_URI}${mapLink}`;
  }

  _getMapPermalinkFromParams({ path }: any, fullURL = true) {
    const mapLink = `demo/map/dropbox?path=${path}`;
    return fullURL
      ? `${Window.location.protocol}//${Window.location.host}/${mapLink}`
      : `/${mapLink}`;
  }

  /** Set file public and return Share URL + folder link. */
  _shareFile(metadata: any) {
    const shareArgs = {
      path: metadata.path_display || metadata.path_lower,
    };

    return this._dropbox
      .sharingListSharedLinks(shareArgs)
      .then(({ links } = {}) => {
        if (links && links.length) {
          return links[0];
        }
        return this._dropbox.sharingCreateSharedLinkWithSettings(shareArgs);
      })
      .then((result: any) => {
        this._shareUrl = this._overrideUrl(result.url);
        return {
          shareUrl: this.getShareUrl(true),
          folderLink: this._folderLink,
        };
      });
  }

  /** Build auth URL (implicit token flow since we read from hash). */
  private async _authLink(path = "auth") {
    return await this._dropbox.auth.getAuthenticationUrl(
      `${Window.location.origin}/${path}`,
      btoa(
        JSON.stringify({ handler: "dropbox", origin: Window.location.origin })
      ),
      "token"
    );
  }

  _overrideUrl(url?: string | null) {
    return url ? url.replace(DOMAIN, CORS_FREE_DOMAIN) : null;
  }

  _getUserFromAccount(response: any) {
    const { name } = response;
    return {
      name: name.display_name,
      email: response.email,
      abbreviated: name.abbreviated_name,
    };
  }

  _getThumbnailRequests(pngs: Record<string, any>) {
    const batches = Object.values(pngs).reduce((accu: any[], c: any) => {
      const lastBatch = accu.length && accu[accu.length - 1];
      if (!lastBatch || lastBatch.length >= MAX_THUMBNAIL_BATCH) {
        accu.push([c]);
      } else {
        (lastBatch as any[]).push(c);
      }
      return accu;
    }, []);

    return batches.map((batch: any[]) =>
      this._dropbox.filesGetThumbnailBatch({
        entries: batch.map((img: any) => ({
          path: img.path_lower,
          format: "png",
          size: "w128h128",
        })),
      })
    );
  }

  async _deleteFileIfExists(path: string) {
    try {
      await this._dropbox.filesDeleteV2({ path });
    } catch (err) {
      if (isDropboxPathNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  /** Parse listFolder result into visualizations + png index. */
  _parseEntries(response: any) {
    const { entries, cursor, has_more } = response;

    if (has_more) this._cursor = cursor;

    const pngs: Record<string, any> = {};
    const visualizations: Record<string, any> = {};

    (entries || []).forEach((entry: any) => {
      const { name, path_lower, id, client_modified } = entry;
      if (name && name.endsWith(".json")) {
        const title = name.replace(/\.json$/, "");
        visualizations[title] = {
          name,
          title,
          id,
          updatedAt: new Date(client_modified).getTime(),
          loadParams: { id, path: path_lower },
        };
      } else if (name && name.endsWith(".png")) {
        const title = name.replace(/\.png$/, "");
        pngs[id] = {
          name: title,
          path_lower,
          id,
          clientModified: new Date(client_modified).getTime(),
        };
      }
    });

    return { visualizations, pngs };
  }
}
