import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseSha256File,
  planFromRelease,
  resolveSelfInstallPath,
  runUpdateSelf,
  selfAssetName,
} from "../../src/core/self.ts";
import { GithubClient } from "../../src/core/providers/github.ts";
import { cleanupDir, tempRoot } from "../helpers/fixtures.ts";

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("update-self helpers", () => {
  test("resolveSelfInstallPath ignora o runtime bun", () => {
    expect(resolveSelfInstallPath("/usr/local/bin/bun")).toBeNull();
    expect(resolveSelfInstallPath("/opt/homebrew/bin/bun")).toBeNull();
    expect(resolveSelfInstallPath("/Users/me/.local/bin/dmngr")).toBe("/Users/me/.local/bin/dmngr");
    expect(resolveSelfInstallPath("/tmp/dmngr-darwin-arm64")).toBe("/tmp/dmngr-darwin-arm64");
  });

  test("parseSha256File aceita formato shasum -c", () => {
    expect(parseSha256File(`${"ab".repeat(32)}  dmngr-darwin-arm64\n`, "dmngr-darwin-arm64")).toBe("ab".repeat(32));
    expect(parseSha256File(`${"cd".repeat(32)} *dmngr-darwin-x64\n`, "dmngr-darwin-x64")).toBe("cd".repeat(32));
    expect(parseSha256File("not-a-hash\n", "dmngr-darwin-arm64")).toBeNull();
  });

  test("planFromRelease compara versões e escolhe o asset da máquina", () => {
    const release = {
      tag: "v0.3.0",
      name: "0.3.0",
      draft: false,
      prerelease: false,
      publishedAt: "2026-10-25T00:00:00Z",
      createdAt: null,
      assets: [
        {
          id: 1,
          name: "dmngr-darwin-arm64",
          size: 10,
          contentType: null,
          digest: `sha256:${"11".repeat(32)}`,
          browserDownloadUrl: "https://example.com/dmngr-darwin-arm64",
          apiUrl: "https://api.example/asset/1",
          updatedAt: null,
        },
        {
          id: 2,
          name: "dmngr-darwin-arm64.sha256",
          size: 80,
          contentType: null,
          digest: null,
          browserDownloadUrl: "https://example.com/dmngr-darwin-arm64.sha256",
          apiUrl: "https://api.example/asset/2",
          updatedAt: null,
        },
      ],
    };
    const available = planFromRelease(release, {
      currentVersion: "0.2.0",
      arch: "arm64",
      installPath: "/tmp/dmngr",
    });
    expect(available.status).toBe("update_available");
    expect(available.latestVersion).toBe("0.3.0");
    expect(available.assetName).toBe(selfAssetName("arm64"));
    expect(available.expectedSha256).toBe("11".repeat(32));

    const current = planFromRelease(release, {
      currentVersion: "0.3.0",
      arch: "arm64",
      installPath: "/tmp/dmngr",
    });
    expect(current.status).toBe("up_to_date");
  });
});

describe("runUpdateSelf", () => {
  test("checkOnly reporta update_available via API local", async () => {
    const dir = await tempRoot("dmngr-self-check");
    const binary = join(dir, "dmngr");
    await writeFile(binary, "#!/bin/sh\necho old\n");
    await chmod(binary, 0o755);
    const payload = new TextEncoder().encode("fake-binary-v2");
    const hash = sha256Hex(payload);

    let base = "";
    const server = Bun.serve({
      port: 0,
      fetch(req: Request): Response {
        const url = new URL(req.url);
        if (url.pathname === "/repos/SimStm/dmngr/releases/latest") {
          return Response.json({
            tag_name: "v9.9.9",
            name: "9.9.9",
            draft: false,
            prerelease: false,
            published_at: "2026-10-25T00:00:00Z",
            assets: [
              {
                id: 1,
                name: "dmngr-darwin-arm64",
                size: payload.byteLength,
                browser_download_url: `${base}/dl/dmngr-darwin-arm64`,
                url: `${base}/api/asset/1`,
                digest: `sha256:${hash}`,
              },
              {
                id: 2,
                name: "dmngr-darwin-arm64.sha256",
                size: 80,
                browser_download_url: `${base}/dl/dmngr-darwin-arm64.sha256`,
                url: `${base}/api/asset/2`,
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    base = `http://127.0.0.1:${server.port}`;

    try {
      const github = new GithubClient({ baseUrl: base, fetchImpl: fetch });
      const result = await runUpdateSelf({
        github,
        policy: { allowHttp: true, allowPrivateNetwork: true },
        maxBytes: 10_000_000,
        checkOnly: true,
        dryRun: false,
        yes: true,
        canPrompt: false,
        installPath: binary,
        arch: "arm64",
        currentVersion: "0.2.0",
      });
      expect(result.action).toBe("check");
      expect(result.plan.status).toBe("update_available");
      expect(result.plan.latestVersion).toBe("9.9.9");
    } finally {
      server.stop(true);
      await cleanupDir(dir);
    }
  });

  test("substitui o binário com --yes após verificar sha256", async () => {
    const dir = await tempRoot("dmngr-self-apply");
    await mkdir(dir, { recursive: true });
    const binary = join(dir, "dmngr");
    await writeFile(binary, "#!/bin/sh\necho old\n");
    await chmod(binary, 0o755);
    const payload = new TextEncoder().encode("#!/bin/sh\necho new-self\n");
    const hash = sha256Hex(payload);
    const checksumBody = `${hash}  dmngr-darwin-arm64\n`;

    let base = "";
    const server = Bun.serve({
      port: 0,
      fetch(req: Request): Response {
        const url = new URL(req.url);
        if (url.pathname === "/repos/SimStm/dmngr/releases/latest") {
          return Response.json({
            tag_name: "v1.2.3",
            draft: false,
            prerelease: false,
            published_at: "2026-10-25T00:00:00Z",
            assets: [
              {
                id: 1,
                name: "dmngr-darwin-arm64",
                size: payload.byteLength,
                browser_download_url: `${base}/dl/bin`,
                url: `${base}/api/1`,
                digest: `sha256:${hash}`,
              },
              {
                id: 2,
                name: "dmngr-darwin-arm64.sha256",
                size: checksumBody.length,
                browser_download_url: `${base}/dl/sum`,
                url: `${base}/api/2`,
              },
            ],
          });
        }
        if (url.pathname === "/dl/bin") return new Response(payload);
        if (url.pathname === "/dl/sum") return new Response(checksumBody);
        return new Response("not found", { status: 404 });
      },
    });
    base = `http://127.0.0.1:${server.port}`;

    try {
      const github = new GithubClient({ baseUrl: base, fetchImpl: fetch });
      const result = await runUpdateSelf({
        github,
        policy: { allowHttp: true, allowPrivateNetwork: true },
        maxBytes: 10_000_000,
        checkOnly: false,
        dryRun: false,
        yes: true,
        canPrompt: false,
        installPath: binary,
        arch: "arm64",
        currentVersion: "1.0.0",
      });
      expect(result.action).toBe("updated");
      expect(result.installedVersion).toBe("1.2.3");
      const installed = await Bun.file(binary).text();
      expect(installed).toContain("new-self");
    } finally {
      server.stop(true);
      await cleanupDir(dir);
    }
  });
});
