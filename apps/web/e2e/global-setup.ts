import { createConnection } from "node:net";

const DEV_PORTS_THAT_MUST_BE_FREE = [5173, 8787] as const;

async function isPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 200 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export default async function globalSetup(): Promise<void> {
  for (const port of DEV_PORTS_THAT_MUST_BE_FREE) {
    if (await isPortOccupied(port)) {
      throw new Error(
        `Port :${port} is in use. Kill \`pnpm dev\` before running \`pnpm e2e\` — ` +
          "a concurrent dev worker or dev SPA can silently participate in upload " +
          "signing or R2 binding state and produce e2e results that don't reflect " +
          "the SUT in isolation.",
      );
    }
  }
}
