import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface ImageFile {
  path: string;
  name: string;
}

export async function selectImageFolder(): Promise<string | null> {
  const path = await open({ directory: true, multiple: false });
  return typeof path === "string" ? path : null;
}

export function listImageFiles(folderPath: string): Promise<ImageFile[]> {
  return invoke<ImageFile[]>("list_image_files", { folderPath });
}

export function imageFileSrc(path: string): string {
  return convertFileSrc(path);
}
