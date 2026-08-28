---
name: Managed workflow contract validation
description: Environment-specific validation details for API contracts in this workspace.
---

Integration tests for a managed API workflow should target the shared proxy rather than assuming the service's local port. Response schemas using Zod date coercion serialize dates as ISO timestamps when Express sends the parsed result.

**Why:** The workflow injects its own service port and the API validates response objects before serialization, so direct-port tests and date-only string assertions can fail even when the service is healthy.

**How to apply:** Use the proxy URL for end-to-end API checks and assert the date portion plus optional ISO time, unless the route deliberately returns an unparsed date string.