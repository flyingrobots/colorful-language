#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { buildLspFixture } from "../src/lsp-fixture.mjs";

const [binary, sourcePath] = process.argv.slice(2);
if (!binary || !sourcePath) {
  process.stderr.write("usage: capture-lsp.mjs COLORFUL_LSP SOURCE\n");
  process.exit(2);
}

const source = readFileSync(sourcePath, "utf8");
const uri = "file:///independent-ir-report.txt";
const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
let buffer = Buffer.alloc(0);
const messages = [];
const waiters = [];

function dispatch(message) {
  const index = waiters.findIndex(({ predicate }) => predicate(message));
  if (index >= 0) {
    const [{ resolve, timeout }] = waiters.splice(index, 1);
    clearTimeout(timeout);
    resolve(message);
  } else {
    messages.push(message);
  }
}

function parseMessages() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) throw new Error("colorful-lsp response omitted Content-Length");
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length);
    buffer = buffer.subarray(bodyStart + length);
    dispatch(JSON.parse(body.toString("utf8")));
  }
}

child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  parseMessages();
});

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
}

function receive(label, predicate) {
  const index = messages.findIndex(predicate);
  if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for ${label}`));
    }, 5_000);
    waiters.push({ predicate, resolve, timeout });
  });
}

async function main() {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { processId: null, rootUri: null, capabilities: {} },
  });
  const initialized = await receive(
    "initialize response",
    (message) => message.id === 1,
  );
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri,
        languageId: "plaintext",
        version: 1,
        text: source,
      },
    },
  });
  await receive(
    "open diagnostics",
    (message) =>
      message.method === "textDocument/publishDiagnostics" &&
      message.params?.uri === uri,
  );
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/semanticTokens/full",
    params: { textDocument: { uri } },
  });
  const semanticTokens = await receive(
    "semantic-token response",
    (message) => message.id === 2,
  );
  send({ jsonrpc: "2.0", id: 3, method: "shutdown", params: null });
  await receive("shutdown response", (message) => message.id === 3);
  send({ jsonrpc: "2.0", method: "exit", params: null });
  child.stdin.end();

  const result = buildLspFixture(initialized, semanticTokens);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  await main();
} catch (error) {
  child.kill();
  throw error;
}
