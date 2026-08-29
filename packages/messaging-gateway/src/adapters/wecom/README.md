# Enterprise WeChat intelligent-bot gateway

This adapter implements the conversation channel described by the Enterprise
WeChat intelligent-bot long-connection documentation. It receives direct and
group messages over the official WebSocket SDK and maps them onto Craft's
normal messaging bindings.

## Scope

Included here:

- one authenticated WebSocket connection per Bot ID;
- direct messages and group messages delivered to the bot;
- text, voice transcription, image, file, video, and mixed-message input;
- Markdown replies, proactive delivery to a known chat ID, file output, and
  template-card buttons for plan and permission decisions;
- duplicate-message suppression, reconnect status, and explicit detection of
  `disconnected_event` when another process replaces the connection;
- workspace owner/open access policy and normal `/pair` session binding.

Not included here:

- Enterprise WeChat CLI or MCP installation/lifecycle;
- Docs, WeDrive, Calendar, Mail, Todo, Meeting, or Contacts tools;
- credential sharing with an independently running stdio MCP process.

Users who need those business operations install the official CLI/MCP and add
it to Craft as a Source. A stdio MCP process is normally owned by one client;
an HTTP/SSE MCP endpoint can be shared by URL. The official business tools and
this conversation adapter are independent unless the selected third-party MCP
also opens a WebSocket for the same Bot ID.

## Connection ownership

Enterprise WeChat permits only one active long connection for the same Bot ID.
Craft prevents two workspaces in the same process from claiming it. If another
process connects, the official SDK emits `disconnected_event`; the adapter
stops reporting itself as connected and exposes a reconnect-required error
instead of fighting the other process in a reconnect loop.

For private deployments, configure the `wss://` endpoint shown in the
Enterprise WeChat administrator console. Otherwise the official SDK default,
`wss://openws.work.weixin.qq.com`, is used.
