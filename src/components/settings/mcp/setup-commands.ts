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

/** Setup commands and config for each assistant, with the endpoint filled in. */
export function mcpSetupCommands(endpoint: string) {
  const vscodeServer = { name: 'opsknight', type: 'http', url: endpoint };
  return {
    claudeCode: `claude mcp add --scope user --transport http opsknight ${quote(endpoint)}`,
    cursor: JSON.stringify({ mcpServers: { opsknight: { url: endpoint } } }, null, 2),
    /** POSIX shells only (macOS, Linux, WSL); Windows users use "MCP: Add Server". */
    vscode: `code --add-mcp ${quote(JSON.stringify(vscodeServer))}`,
    /** From an OpsKnight source checkout. */
    doctor: `node scripts/mcp/doctor.cjs ${quote(endpoint)}`,
    /** From the host running the OpsKnight container (the image ships scripts/). */
    doctorDocker: `docker exec <opsknight-container> node scripts/mcp/doctor.cjs ${quote(endpoint)}`,
    /** One-click installs: Cursor takes base64 JSON config, VS Code URL-encoded JSON. */
    cursorInstall: `cursor://anysphere.cursor-deeplink/mcp/install?name=opsknight&config=${encodeURIComponent(
      base64(JSON.stringify({ url: endpoint }))
    )}`,
    vscodeInstall: `vscode:mcp/install?${encodeURIComponent(JSON.stringify(vscodeServer))}`,
  };
}
