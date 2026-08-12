import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Fixture documents are gitignored, so any checkout may be missing them. Tests
 * that need one gate on `hasFixture` and skip rather than fail — a red suite
 * caused by an absent file says nothing about the code.
 */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(name, import.meta.url));
}

export function hasFixture(name: string): boolean {
  return existsSync(fixturePath(name));
}

export async function readFixture(name: string): Promise<Uint8Array> {
  return readFile(fixturePath(name));
}
