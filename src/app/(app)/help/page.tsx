import McpConnectEntry from '@/components/settings/mcp/McpConnectEntry';
import { loadMcpInForce } from '@/lib/mcp/core/policy-in-force';
import HelpCenter from './HelpCenter';

export const dynamic = 'force-dynamic';

export default async function HelpPage() {
  return <HelpCenter mcpEntry={(await loadMcpInForce()) ? <McpConnectEntry /> : null} />;
}
