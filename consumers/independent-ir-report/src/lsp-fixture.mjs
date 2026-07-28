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
