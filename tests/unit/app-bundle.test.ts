import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  assessAppSignature,
  describeArchs,
  isAppBundle,
  isAppRunning,
  readAppBundle,
} from "../../src/core/inspect/app-bundle.ts";
import { StateError } from "../../src/core/errors.ts";
import { cleanupDir, createAppBundle, tempRoot } from "../helpers/fixtures.ts";

describe("app bundles", () => {
  test("lê identidade, versão e arquitetura", async () => {
    const dir = await tempRoot("dmngr-bundle");
    try {
      const app = await createAppBundle(dir, {
        name: "Example",
        bundleId: "com.example.app",
        displayName: "Example App",
        shortVersion: "3.4.5",
        buildVersion: "345",
      });
      expect(await isAppBundle(app)).toBe(true);
      const info = await readAppBundle(app);
      expect(info.bundleId).toBe("com.example.app");
      expect(info.name).toBe("Example App");
      expect(info.shortVersion).toBe("3.4.5");
      expect(info.buildVersion).toBe("345");
      expect(info.executable).toBe("Example");
      expect(info.archs).toBeNull(); // script não é Mach-O
      expect(describeArchs(info.archs)).toBeNull();
    } finally {
      await cleanupDir(dir);
    }
  });

  test("detecta bundle inválido", async () => {
    const dir = await tempRoot("dmngr-bundle-bad");
    try {
      const app = join(dir, "Quebrado.app");
      await mkdir(join(app, "Contents"), { recursive: true });
      expect(await isAppBundle(app)).toBe(false);
      await expect(readAppBundle(app)).rejects.toThrow(StateError);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("app não assinado reprova integridade; ad-hoc passa codesign e reprova spctl", async () => {
    const dir = await tempRoot("dmngr-sign");
    try {
      const unsigned = await createAppBundle(dir, { name: "Unsigned", signed: false });
      const unsignedAssessment = await assessAppSignature(unsigned);
      expect(unsignedAssessment.integrityOk).toBe(false);
      expect(unsignedAssessment.signed).toBe(false);
      expect(unsignedAssessment.notarized).toBe(false);

      const signed = await createAppBundle(dir, { name: "Adhoc" });
      const signedAssessment = await assessAppSignature(signed);
      expect(signedAssessment.integrityOk).toBe(true);
      expect(signedAssessment.signed).toBe(true);
      expect(signedAssessment.notarized).toBe(false);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("app recém-criado não está em execução", async () => {
    const dir = await tempRoot("dmngr-running");
    try {
      const app = await createAppBundle(dir, { name: "Parado" });
      expect(await isAppRunning(app, "Parado")).toBe(false);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("Informação extra em Info.plist binário é lida", async () => {
    const dir = await tempRoot("dmngr-binary-plist");
    try {
      const app = await createAppBundle(dir, { name: "Bin" });
      const { run } = await import("../../src/core/process.ts");
      await run(["plutil", "-convert", "binary1", join(app, "Contents", "Info.plist")]);
      const info = await readAppBundle(app);
      expect(info.bundleId).toBe("com.dmngr.bin");
    } finally {
      await cleanupDir(dir);
    }
  });
});
