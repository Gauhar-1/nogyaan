import { spawn } from "node:child_process";

const child = spawn("node", ["dist/cli.js", "serve"], {
  stdio: ["pipe", "pipe", "inherit"],
});

const initMsg = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

child.stdout.on("data", (data) => {
  const str = data.toString();
  console.log("MCP STDOUT:", str);
  if (str.includes('"result"')) {
    console.log("✔ MCP handshake successful!");
    child.kill();
    process.exit(0);
  }
});

child.stdin.write(JSON.stringify(initMsg) + "\n");

setTimeout(() => {
  console.error("Timeout waiting for MCP response");
  child.kill();
  process.exit(1);
}, 5000);

