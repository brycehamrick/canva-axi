#!/usr/bin/env node
// Fast-path entrypoint: answer bare --version probes without loading the full
// command graph (AXI principle 10). All other argv falls through to the CLI.
import { tryFastPath } from "axi-sdk-js/fast-path";
import { VERSION } from "../dist/version.js";

if (!tryFastPath(process.argv.slice(2), { version: VERSION })) {
  const { main } = await import("../dist/cli.js");
  await main();
}
