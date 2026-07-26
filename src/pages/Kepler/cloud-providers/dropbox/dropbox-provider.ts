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

type DropboxAuth = {
  setAccessToken(token: string): void;
  getAccessToken(): string | null | undefined;
  getAuthenticationUrl(
    redirectUri: string,
    state?: string,
    responseType?: "token" | "code",
    tokenAccessType?: "offline" | "legacy" | "online",
    scope?: string[],
    includeGrantedScopes?: boolean,
    usePKCE?: boolean
  ): Promise<string>;
};

type DropboxClient = {
  auth: DropboxAuth;
  usersGetCurrentAccount(): Promise<any>;
  filesListFolder(args: { path: string }): Promise<any>;
  filesUpload(args: {
    path: string;
    contents: any;
    mode: "add" | "overwrite";
  }): Promise<any>;
  filesDeleteV2(args: { path: string }): Promise<any>;
  filesDownload(args: { path: string }): Promise<any>;
  filesGetThumbnailBatch(args: {
    entries: Array<{ path: string; format: "png"; size: "w128h128" }>;
  }): Promise<any>;
  sharingListSharedLinks(args: { path: string }): Promise<any>;
  sharingCreateSharedLinkWithSettings(args: { path: string }): Promise<any>;
  authTokenRevoke(): Promise<void>;
};

const NAME = "dropbox";
const DISPLAY_NAME = "Dropbox";
const DOMAIN = "www.dropbox.com";
const KEPLER_DROPBOX_FOLDER_LINK = `//${DOMAIN}/home/Apps`;
const CORS_FREE_DOMAIN = "dl.dropboxusercontent.com";
const PRIVATE_STORAGE_ENABLED = true;
const SHARING_ENABLED = true;
const MAX_THUMBNAIL_BATCH = 25;
const IMAGE_URL_PREFIX = "data:image/png;base64,";
const THUMBNAIL_WIDTH = 960;
const THUMBNAIL_HEIGHT = 540;
const MAP_RENDER_CAPTURE_DELAY_MS = 700;
const ASYNC_PROJECT_THUMBNAIL_ENABLED =
  String(
    import.meta.env.VITE_ASYNC_PROJECT_THUMBNAIL ?? "true"
  ).toLowerCase() !== "false";

function unwrapDropboxResponse(response: any) {
  return response?.result ?? response;
}

function parseQueryString(query: string): Record<string, string> {
  const searchParams = new URLSearchParams(query);
  const params: Record<string, string> = {};
  for (const p of searchParams) {
    if (p && p.length === 2 && p[0]) params[p[0]] = p[1];
  }
  return params;
}

function isConfigFile(err: any): boolean {
  const summary = err?.error?.error_summary ?? err?.error_summary ?? "";
  return typeof summary === "string" && Boolean(summary.match(/path\/conflict\/file\//g));
}

function isDropboxPathNotFound(err: any): boolean {
  const summary = err?.error?.error_summary ?? err?.error_summary ?? "";
  return typeof summary === "string" && summary.includes("path/not_found");
}

function getThumbnailPathFromMapPath(path: string) {
  return path.replace(/\.json$/i, ".png");
}

function isMaonoManagedProjectRoute() {
  const pathname = String(Window.location?.pathname || "");

  return /^\/projects\/[^/]+\/map\/?$/i.test(pathname);
}

export default class DropboxProvider extends Provider {
  clientId: string | null;
  appName: string;
  _folderLink: string;
  _path: string;
  _dropbox!: DropboxClient;
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

  async login(): Promise<any> {
    return new Promise<any>(async (resolve, reject) => {
      try {
        const link = await this._authLink();
        const authWindow = Window.open(link, "_blank", "width=1024,height=716");

        const handleToken = async (event: MessageEvent<any>) => {
          if (!event?.data?.token) return;

          if (authWindow) {
            authWindow.close();
            Window.removeEventListener("message", handleToken as any);
          }

          const { token } = event.data as { token?: string };
          if (!token) {
            reject("Failed to login to Dropbox");
            return;
          }

          this._dropbox.auth.setAccessToken(token);
          const user = await this.getUser();

          if (Window.localStorage) {
            Window.localStorage.setItem(
              "dropbox",
              JSON.stringify({ token, user, timestamp: new Date() })
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

  async listMaps(): Promise<any[]> {
    try {
      const response = unwrapDropboxResponse(
        await this._dropbox.filesListFolder({ path: `${this._path}` })
      );
      const { pngs, visualizations } = this._parseEntries(response);

      const thumbnails = await Promise.all(
        this._getThumbnailRequests(pngs)
      ).then((results) =>
        results.reduce((accu: any[], r: any) => {
          const result = unwrapDropboxResponse(r);
          return [...accu, ...(result.entries || [])];
        }, [])
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
   * Salva o JSON canônico e substitui o PNG canônico do projeto.
   * Se o Kepler não enviar thumbnail, captura o maior canvas visível do mapa.
   */
  async uploadMap({ mapData, options = {} }: any) {
    const { isPublic } = options;
    const { map, thumbnail } = mapData;

    const name = map?.info && map.info.title;
    const fileName = `${name}.json`;
    const path = `${this._path}/${fileName}`;

    // Nos projetos Maono, o endpoint versionado faz a captura depois que o
    // JSON foi confirmado. O provider mantém o comportamento nativo fora
    // dessa rota e durante um rollback explícito da feature flag.
    const thumbnailToSave =
      ASYNC_PROJECT_THUMBNAIL_ENABLED && isMaonoManagedProjectRoute()
        ? null
        : thumbnail || (await this._safeCaptureCurrentMapThumbnail());

    const uploadRes = await this._dropbox.filesUpload({
      path,
      contents: JSON.stringify(map),
      mode: "overwrite",
    });
    const metadata = unwrapDropboxResponse(uploadRes);

    if (thumbnailToSave) {
      await this.replaceThumbnailForMapPath(path, thumbnailToSave);
    }

    if (isPublic) {
      return await this._shareFile(metadata);
    }

    return { id: metadata.id, path: metadata.path_lower };
  }

  /** Substitui somente a imagem PNG, sem criar outro JSON e sem acumular imagens antigas. */
  async replaceThumbnailForMapPath(mapPath: string, thumbnail: Blob) {
    const thumbnailPath = getThumbnailPathFromMapPath(mapPath);

    await this._deleteFileIfExists(thumbnailPath);

    const response = await this._dropbox.filesUpload({
      path: thumbnailPath,
      contents: thumbnail,
      mode: "overwrite",
    });

    return unwrapDropboxResponse(response);
  }

  async captureCurrentMapThumbnail() {
    return await this._captureCurrentMapThumbnail();
  }

  async downloadMap(loadParams: { path: string }): Promise<{ map: any; format: string }> {
    const { path } = loadParams;
    const result = unwrapDropboxResponse(await this._dropbox.filesDownload({ path }));
    const json = await this._readFile(result.fileBlob);

    return Promise.resolve({ map: json, format: KEPLER_FORMAT });
  }

  getUserName(): any {
    if (Window.localStorage) {
      const jsonString = Window.localStorage.getItem("dropbox");
      return jsonString && JSON.parse(jsonString).user;
    }
    return null;
  }

  async logout(): Promise<void> {
    try {
      await this._dropbox.authTokenRevoke();
    } catch {
      // ignore
    }
    if (Window.localStorage) {
      Window.localStorage.removeItem("dropbox");
    }
    this._initializeDropbox();
  }

  isEnabled(): boolean {
    return this.clientId !== null;
  }

  hasPrivateStorage(): boolean {
    return PRIVATE_STORAGE_ENABLED;
  }

  hasSharingUrl(): boolean {
    return SHARING_ENABLED;
  }

  getShareUrl(fullUrl = true): string | null {
    return fullUrl
      ? `${Window.location.protocol}//${Window.location.host}/${MAP_URI}${this._shareUrl ?? ""}`
      : `/${MAP_URI}${this._shareUrl ?? ""}`;
  }

  getMapUrl(loadParams: { path: string }): string {
    const { path } = loadParams;
    return path;
  }

  getManagementUrl(): string {
    return this._folderLink;
  }

  getAccessToken(): string | null {
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

  getAccessTokenFromLocation(location: Location): string | null {
    if (!(location && (location as any).hash?.length)) return null;
    const query = Window.location.hash.substring(1);
    return parseQueryString(query).access_token ?? null;
  }

  private _initializeDropbox(): void {
    const boundFetch: typeof fetch =
      typeof window !== "undefined" && typeof window.fetch === "function"
        ? window.fetch.bind(window)
        : (fetch as any);

    this._dropbox = new DropboxCtor({
      clientId: this.clientId,
      fetch: boundFetch,
    }) as DropboxClient;
  }

  private async getUser(): Promise<{ name: string; email: string; abbreviated: string }> {
    const token = this._dropbox.auth.getAccessToken?.();
    if (!token) throw new Error("Dropbox: no access token set before getUser()");

    const res = await this._dropbox.usersGetCurrentAccount();
    const account = unwrapDropboxResponse(res);

    return this._getUserFromAccount(account);
  }

  private _handleDropboxError(error: any): Error {
    if (error?.error?.error_summary) {
      return new Error(`Dropbox Error: ${error.error.error_summary}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private _readFile(fileBlob: Blob): Promise<any> {
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

  private _getMapPermalink(mapLink: string, fullUrl = true): string {
    return fullUrl
      ? `${Window.location.protocol}//${Window.location.host}/${MAP_URI}${mapLink}`
      : `/${MAP_URI}${mapLink}`;
  }

  private _getMapPermalinkFromParams({ path }: { path: string }, fullURL = true): string {
    const mapLink = `map/dropbox?path=${path}`;
    return fullURL
      ? `${Window.location.protocol}//${Window.location.host}/${mapLink}`
      : `/${mapLink}`;
  }

  private _shareFile(rawMeta: any) {
    const meta = unwrapDropboxResponse(rawMeta);
    const path =
      meta?.path_display ??
      meta?.path_lower ??
      meta?.metadata?.path_display ??
      meta?.metadata?.path_lower;

    if (!path) {
      throw new Error("Dropbox: missing file path in metadata for sharing");
    }

    const shareArgs = { path };

    return this._dropbox
      .sharingListSharedLinks(shareArgs)
      .then((res: any) => {
        const links = unwrapDropboxResponse(res)?.links ?? [];
        return links.length ? links[0] : this._dropbox.sharingCreateSharedLinkWithSettings(shareArgs);
      })
      .then((res: any) => {
        const out = unwrapDropboxResponse(res);
        this._shareUrl = this._overrideUrl(out.url) || "";
        return {
          shareUrl: this.getShareUrl(true),
          folderLink: this._folderLink,
        };
      });
  }

  private async _authLink(path = "auth"): Promise<string> {
    return await this._dropbox.auth.getAuthenticationUrl(
      `${Window.location.origin}/${path}`,
      btoa(JSON.stringify({ handler: "dropbox", origin: Window.location.origin }))
    );
  }

  private _overrideUrl(url?: string | null): string | null {
    return url ? url.replace(DOMAIN, CORS_FREE_DOMAIN) : null;
  }

  private _getUserFromAccount(response: any): { name: string; email: string; abbreviated: string } {
    if (!response) return { name: "Unknown", email: "", abbreviated: "" };

    const nameObj = response.name ?? response.name_details ?? {};
    const display =
      nameObj.display_name ??
      ([nameObj.given_name, nameObj.surname].filter(Boolean).join(" ") || "Unknown");

    return {
      name: display,
      email: response.email ?? "",
      abbreviated: nameObj.abbreviated_name ?? "",
    };
  }

  private _getThumbnailRequests(pngs: Record<string, any>): Array<Promise<any>> {
    const batches: any[][] = Object.values(pngs).reduce((accu: any[], c: any) => {
      const lastBatch = accu.length && (accu[accu.length - 1] as any[]);
      if (!lastBatch || lastBatch.length >= MAX_THUMBNAIL_BATCH) {
        accu.push([c]);
      } else {
        lastBatch.push(c);
      }
      return accu;
    }, []);

    return batches.map((batch: any[]) =>
      this._dropbox.filesGetThumbnailBatch({
        entries: batch.map((img: any) => ({
          path: img.path_lower,
          format: "png" as const,
          size: "w128h128" as const,
        })),
      })
    );
  }

  private async _deleteFileIfExists(path: string) {
    try {
      await this._dropbox.filesDeleteV2({ path });
    } catch (err) {
      if (isDropboxPathNotFound(err)) return null;
      throw err;
    }
  }

  private async _safeCaptureCurrentMapThumbnail() {
    try {
      return await this._captureCurrentMapThumbnail();
    } catch (err) {
      console.warn("Maõno Maps: não foi possível capturar o preview PNG do mapa.", err);
      return null;
    }
  }

  private async _captureCurrentMapThumbnail() {
    await this._delay(MAP_RENDER_CAPTURE_DELAY_MS);

    const sourceCanvas = this._getLargestVisibleCanvas();
    if (!sourceCanvas) {
      throw new Error("Canvas do mapa não encontrado para geração do preview.");
    }

    return await this._copyCanvasToPngBlob(sourceCanvas);
  }

  private _getLargestVisibleCanvas() {
    const canvases = Array.from(Window.document.querySelectorAll("canvas"));

    return (
      canvases
        .filter((canvas: HTMLCanvasElement) => {
          const rect = canvas.getBoundingClientRect();
          return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0;
        })
        .sort((a: HTMLCanvasElement, b: HTMLCanvasElement) => b.width * b.height - a.width * a.height)[0] || null
    );
  }

  private _copyCanvasToPngBlob(sourceCanvas: HTMLCanvasElement) {
    const outputCanvas = Window.document.createElement("canvas");
    outputCanvas.width = THUMBNAIL_WIDTH;
    outputCanvas.height = THUMBNAIL_HEIGHT;

    const ctx = outputCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("Contexto 2D não disponível para geração do preview.");
    }

    const sourceWidth = sourceCanvas.width;
    const sourceHeight = sourceCanvas.height;
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT;

    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;

    if (sourceRatio > targetRatio) {
      sw = sourceHeight * targetRatio;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetRatio;
      sy = (sourceHeight - sh) / 2;
    }

    ctx.fillStyle = "#08090B";
    ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

    return new Promise((resolve, reject) => {
      outputCanvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Canvas retornou Blob vazio ao gerar preview."));
            return;
          }
          resolve(blob);
        },
        "image/png",
        0.92
      );
    });
  }

  private _delay(ms: number) {
    return new Promise((resolve) => Window.setTimeout(resolve, ms));
  }

  private _parseEntries(response: any): {
    visualizations: Record<string, any>;
    pngs: Record<string, any>;
  } {
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
