import { randomUUID } from "node:crypto";
import { File, Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";
const storage = new Storage({ credentials: { audience: "replit", subject_token_type: "access_token", token_url: `${SIDECAR}/token`, type: "external_account", credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } }, universe_domain: "googleapis.com" }, projectId: "" });
const parse = (value: string) => { const parts = value.replace(/^\/+/, "").split("/"); return { bucket: parts.shift()!, object: parts.join("/") }; };
export class ObjectStorageService {
  private dir() { if (!process.env.PRIVATE_OBJECT_DIR) throw new Error("PRIVATE_OBJECT_DIR is not configured"); return process.env.PRIVATE_OBJECT_DIR.replace(/\/$/, ""); }
  async uploadUrl() { const objectPath = `${this.dir()}/uploads/${randomUUID()}`; const { bucket, object } = parse(objectPath); const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bucket_name: bucket, object_name: object, method: "PUT", expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }) }); if (!response.ok) throw new Error("Unable to create upload URL"); const body = await response.json() as { signed_url: string }; return { uploadURL: body.signed_url, objectPath: `/objects/${objectPath.slice(this.dir().length + 1)}` }; }
  async file(path: string): Promise<File> { if (!path.startsWith("/objects/")) throw new Error("Invalid object path"); const { bucket, object } = parse(`${this.dir()}/${path.slice("/objects/".length)}`); const file = storage.bucket(bucket).file(object); const [exists] = await file.exists(); if (!exists) throw new Error("Object not found"); return file; }
}