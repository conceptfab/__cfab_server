import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

const nextConfig: NextConfig = {
  turbopack: {
    // Use the config file location, not the shell cwd (which may be a parent folder).
    root: projectRoot,
  },
  serverExternalPackages: ["ssh2", "ssh2-sftp-client"],
};

export default nextConfig;
