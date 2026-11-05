'use server';

import { listMcpConnectionActivity, type McpConnectionActivity } from './activity';
import { loadMcpViewer } from './queries';

/** The connection drawer's data; the query itself checks the viewer may see this connection. */
export async function loadMcpConnectionActivity(input: unknown): Promise<McpConnectionActivity> {
  const viewer = await loadMcpViewer();
  return listMcpConnectionActivity(viewer, input);
}
