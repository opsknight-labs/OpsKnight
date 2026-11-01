/** Shell-quotes one argument for POSIX shells. */
function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Setup commands and config for each assistant, with the endpoint filled in. */
export function mcpSetupCommands(endpoint: string) {
  return {
    claudeCode: `claude mcp add --scope user --transport http opsknight ${quote(endpoint)}`,
    cursor: JSON.stringify({ mcpServers: { opsknight: { url: endpoint } } }, null, 2),
    vscode: `code --add-mcp ${quote(JSON.stringify({ name: 'opsknight', type: 'http', url: endpoint }))}`,
    doctor: `node scripts/mcp/doctor.cjs ${quote(endpoint)}`,
  };
}
