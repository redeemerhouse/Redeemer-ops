import { randomUUID } from "node:crypto";
import { File, Storage } from "@google-cloud/storage";
import {
  assertEnvironmentContract,
  type EnvironmentContract,
} from "./environment";
import { notFound, unavailable, ServiceFailure } from "./serviceFailures";

const SIDECAR = "http://127.0.0.1:1106";
const STORAGE_TIMEOUT_MS = 10_000;
const parse = (value: string) => { const parts = value.replace(/^\/+/, "").split("/"); return { bucket: parts.shift()!, object: parts.join("/") }; };
type StorageProvider = {
  requestSignedUpload(bucket: string, object: string): Promise<Response>;
  file(bucket: string, object: string): File;
};

const productionProvider = (): StorageProvider => {
  const storage = new Storage({ credentials: { audience: "replit", subject_token_type: "access_token", token_url: `${SIDECAR}/token`, type: "external_account", credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } }, universe_domain: "googleapis.com" }, projectId: "" });
  return {
    requestSignedUpload: (bucket, object) => fetch(`${SIDECAR}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket_name: bucket, object_name: object, method: "PUT", expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }),
    }),
    file: (bucket, object) => storage.bucket(bucket).file(object),
  };
};

const isProductionStorage = (contract: EnvironmentContract): boolean =>
  contract.appEnvironment === "production" && contract.storageMode === "production";
async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(unavailable("object_storage", "Object storage is temporarily unavailable.")), STORAGE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export class ObjectStorageService {
  constructor(
    private readonly contract: EnvironmentContract = assertEnvironmentContract(),
    private readonly provider?: StorageProvider,
  ) {}

  private dir() { if (!process.env.PRIVATE_OBJECT_DIR) throw new Error("PRIVATE_OBJECT_DIR is not configured"); return process.env.PRIVATE_OBJECT_DIR.replace(/\/$/, ""); }
  async uploadUrl() {
    const objectPath = `${this.dir()}/uploads/${randomUUID()}`;
    if (!isProductionStorage(this.contract)) {
      return {
        uploadURL: "data:application/octet-stream,synthetic-upload",
        objectPath: `/objects/${objectPath.slice(this.dir().length + 1)}`,
      };
    }
    const { bucket, object } = parse(objectPath);
    try {
      const response = await withTimeout((this.provider ?? productionProvider()).requestSignedUpload(bucket, object));
      if (!response.ok) throw unavailable("object_storage");
      const body = await withTimeout(response.json()) as { signed_url?: unknown };
      if (typeof body.signed_url !== "string" || !/^https?:\/\//.test(body.signed_url)) {
        throw new ServiceFailure("object_storage", "unexpected", "Object storage returned an invalid response.", 502, true);
      }
      return { uploadURL: body.signed_url, objectPath: `/objects/${objectPath.slice(this.dir().length + 1)}` };
    } catch (error) {
      if (error instanceof ServiceFailure) throw error;
      throw unavailable("object_storage");
    }
  }
  async file(path: string): Promise<File> {
    if (!path.startsWith("/objects/")) throw new ServiceFailure("object_storage", "invalid", "Invalid object path.", 400, false);
    if (!isProductionStorage(this.contract)) throw notFound("object_storage", "Object not found.");
    const { bucket, object } = parse(`${this.dir()}/${path.slice("/objects/".length)}`);
    try {
      const file = (this.provider ?? productionProvider()).file(bucket, object);
      const [exists] = await withTimeout(file.exists());
      if (!exists) throw notFound("object_storage", "Object not found.");
      return file;
    } catch (error) {
      if (error instanceof ServiceFailure) throw error;
      throw unavailable("object_storage");
    }
  }
  async metadata(file: File): Promise<{ contentType?: string }> {
    try {
      const [metadata] = await withTimeout(file.getMetadata());
      return {
        ...(typeof metadata.contentType === "string" ? { contentType: metadata.contentType } : {}),
      };
    } catch (error) {
      if (error instanceof ServiceFailure) throw error;
      throw unavailable("object_storage");
    }
  }
}