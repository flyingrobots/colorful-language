import { fail, isRecord } from "./common.mjs";

function stringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  );
}

function unsignedIntegerArray(value) {
  return (
    Array.isArray(value) &&
    value.every((entry) => Number.isSafeInteger(entry) && entry >= 0)
  );
}

export function waitForChildExit(
  child,
  {
    timeoutMs = 5_000,
    schedule = setTimeout,
    cancel = clearTimeout,
  } = {},
) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      if (timer !== undefined) cancel(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    };
    const onExit = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    child.once("exit", onExit);
    child.once("error", onError);
    timer = schedule(() => {
      cleanup();
      child.kill();
      reject(
        new Error("colorful-lsp did not exit after the exit notification"),
      );
    }, timeoutMs);
  });
}

export function buildLspFixture(initialized, semanticTokens) {
  const initialization = isRecord(initialized?.result)
    ? initialized.result
    : null;
  const serverInfo = isRecord(initialization?.serverInfo)
    ? initialization.serverInfo
    : null;
  const provider = isRecord(
    initialization?.capabilities?.semanticTokensProvider,
  )
    ? initialization.capabilities.semanticTokensProvider
    : null;
  const tokenTypes = provider?.legend?.tokenTypes;
  const data = semanticTokens?.result?.data;
  if (
    serverInfo?.name !== "colorful-lsp" ||
    typeof serverInfo.version !== "string" ||
    !stringArray(tokenTypes) ||
    !unsignedIntegerArray(data) ||
    data.length % 5 !== 0
  ) {
    fail("E_LSP_SHAPE", "LSP capture received an error or malformed response");
  }
  return {
    fixtureVersion: "colorful.lsp-fixture/v1",
    serverInfo,
    legend: tokenTypes,
    data,
  };
}
