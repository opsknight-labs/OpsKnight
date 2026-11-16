/** Shell-quotes one argument for POSIX shells. */
function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Base64 of UTF-8 text, in the browser and on the server alike. */
function base64(text: string) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Where each release's doctor script is published; the script is pinned to the running version. */
const DOCTOR_RAW = 'https://raw.githubusercontent.com/opsknight-labs/OpsKnight';

/**
 * Setup commands and config for each assistant, with the endpoint filled in. `version` is the
 * running release (APP_VERSION), so the downloaded doctor matches the server it checks.
 */
export function mcpSetupCommands(endpoint: string, version: string) {
  const vscodeServer = { name: 'opsknight', type: 'http', url: endpoint };
  const tag = `v${version.replace(/^v/, '')}`;
  return {
    claudeCode: `claude mcp add --scope user --transport http opsknight ${quote(endpoint)}`,
    cursor: JSON.stringify({ mcpServers: { opsknight: { url: endpoint } } }, null, 2),
    /** POSIX shells only (macOS, Linux, WSL); Windows users use "MCP: Add Server". */
    vscode: `code --add-mcp ${quote(JSON.stringify(vscodeServer))}`,
    /** Codex CLI: add the server, then sign in (OAuth). */
    codex: `codex mcp add opsknight --url ${quote(endpoint)}`,
    codexLogin: 'codex mcp login opsknight',
    /** Gemini CLI: Streamable HTTP; then run /mcp auth opsknight inside Gemini CLI. */
    geminiCli: `gemini mcp add --transport http opsknight ${quote(endpoint)}`,
    /** ~/.gemini/settings.json: Gemini uses httpUrl for Streamable HTTP (url selects SSE). */
    geminiSettings: JSON.stringify({ mcpServers: { opsknight: { httpUrl: endpoint } } }, null, 2),
    /** ~/.codeium/windsurf/mcp_config.json: Windsurf uses serverUrl. */
    windsurf: JSON.stringify({ mcpServers: { opsknight: { serverUrl: endpoint } } }, null, 2),
    /**
     * From any machine with Node.js 20, no checkout: the doctor published with this release. Not
     * served by OpsKnight itself: a misrouted instance is exactly what the doctor diagnoses.
     */
    doctor: `curl -fsSLo opsknight-mcp-doctor.cjs ${DOCTOR_RAW}/${tag}/scripts/mcp/doctor.cjs && node opsknight-mcp-doctor.cjs ${quote(endpoint)}`,
    /** From an OpsKnight source checkout. */
    doctorSource: `node scripts/mcp/doctor.cjs ${quote(endpoint)}`,
    /** From the host running the OpsKnight container (the image ships scripts/). */
    doctorDocker: `docker exec <opsknight-container> node scripts/mcp/doctor.cjs ${quote(endpoint)}`,
    /** Kubernetes: inside the running deployment. */
    doctorKubernetes: `kubectl exec deploy/<opsknight> -- node scripts/mcp/doctor.cjs ${quote(endpoint)}`,
    /**
     * One-click installs, in the vendors' documented formats: Cursor takes base64 JSON config
     * (cursor.com/docs/mcp/install-links), VS Code URL-encoded JSON
     * (code.visualstudio.com/api/extension-guides/ai/mcp, "Create an MCP installation URL").
     */
    cursorInstall: `cursor://anysphere.cursor-deeplink/mcp/install?name=opsknight&config=${encodeURIComponent(
      base64(JSON.stringify({ url: endpoint }))
    )}`,
    vscodeInstall: `vscode:mcp/install?${encodeURIComponent(JSON.stringify(vscodeServer))}`,
    vscodeInsidersInstall: `vscode-insiders:mcp/install?${encodeURIComponent(JSON.stringify(vscodeServer))}`,
  };
}
