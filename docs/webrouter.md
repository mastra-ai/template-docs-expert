# Optional WebRouter tools

**Local/container integration. Mastra Platform deployment is unverified.**

The default remains Gateway/OpenRouter search. Set `DOCS_WEB_PROVIDER=webrouter`
to replace that tool with [WebRouter](https://github.com/Nimbleway/webrouter)
search and explicit page extraction through its Python stdio MCP server.
The agent model and conversation storage stay the same.

## Local setup

The template still needs its [Gateway key and credit](https://mastra.ai/docs/mastra-platform/gateway/quickstart)
for inference; keyless WebRouter tools do not replace that requirement.

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) with `uvx`
   on PATH. The package requires Python 3.11+; uv normally
   [downloads a compatible interpreter when needed](https://docs.astral.sh/uv/concepts/python-versions/#installing-a-python-version).
2. Run `npm install`, copy `.env.example` to `.env`, and set the template's
   Gateway and Turso values. Add:

   ```dotenv
   DOCS_WEB_PROVIDER=webrouter
   # Optional: an existing file holding your web-provider credentials.
   # WEB_ROUTER_ENV_FILE=/absolute/path/to/provider.env
   ```

3. Run `npm run dev`. Mastra starts the published server automatically:

   ```sh
   uvx --from "webrouter[mcp]==0.15.0" web-router-mcp
   ```

   No clone or manually started server is required. The package version is pinned
   for repeatable setup; first launch downloads its Python dependencies.
   The server receives `WEB_ROUTER_MCP_TOOLS=search,extract`, so it only serves
   the two tools this agent needs.

4. Ask in Studio:

   > Find Mastra's MCPClient documentation, read the reference page, and explain
   > how to start a stdio server. Cite the page you read.

Provider credentials are loaded at startup from `WEB_ROUTER_ENV_FILE` (when set),
the user configuration directory's `.env`, a remembered credential file, then the
working directory's `.env`. Earlier sources win per credential; later files only
fill missing values. An explicit file does not disable the other sources. See
[WebRouter MCP setup](https://docs.webrouter.net/mcp-server#then-add-whichever-keys-you-have).
Mastra's subprocess inherits a limited environment, so credentials exported in
Node are **not** automatically forwarded. Use the credential file for providers
such as `NIMBLE_API_KEY`, `TAVILY_API_KEY`, or `EXA_API_KEY`. Keep it out of version
control. Source URLs and page text survive the MCP results; long pages can be
truncated, so omitted text cannot support a claim.

Search and extraction default to WebRouter's `auto` routing, including fallback
among available providers. The discovered schemas let the agent select a named
provider. Keyless search and extraction can work without a provider account, but
are subject to public endpoint limits and availability. Existing user credentials
may make `auto` choose paid providers; keyless mode is not a cost guarantee.
Only `search` and `extract` are exposed to the agent. Browser, research, local
credential-loading, and other server tools are excluded.

A missing `uvx`, failed package launch, or missing MCP tool fails visibly.
There is no automatic fallback to Gateway when WebRouter setup fails. Set
`DOCS_WEB_PROVIDER=gateway` (or remove it) and restart to restore the baseline.

## Deployment

This uses Mastra's [MCPClient stdio transport](https://mastra.ai/reference/tools/mcp-client).
The runtime needs Node, Python 3.11+, uvx on PATH, subprocess support, and outbound
access to selected providers. Prewarm the pinned package during container setup
to download Python dependencies before serving requests. The client connects lazily
when agent tools are requested. Concurrent requests share one discovery promise;
successful discovery is cached until disconnect, and failed startup can be retried.
Its default process hooks disconnect on shutdown.
If the host manages shutdown itself, set `registerProcessHooks: false` on the
`MCPClient` and call `disconnectWebRouter()` from the host's shutdown handler.

A successful JavaScript build does not package Python or prove a managed platform
supports subprocesses. Use a local machine or a container/VM with these prerequisites;
verify deployment support before enabling this on Mastra Platform or serverless
hosts. Gateway still handles inference. Web-provider billing, quotas, routing and
data handling remain separate from Gateway credits, spend controls and regions.

## Reproduce a comparison

```sh
npm test
npm run typecheck
npm run build
npm run --silent compare > comparison.jsonl
```

The comparison requires `.env` with a Gateway key and WebRouter setup. It runs
three fixed questions through both paths, alternates their order, keeps the same
`AGENT_MODEL`, system instructions and 100-step limit, and disables conversation
memory for independent answers. Each WebRouter run includes a new subprocess;
latency includes discovery/startup, but excludes any prior dependency installation.
Repeat runs to report a median and range instead of treating one call as a benchmark.

The only system-prompt change from the original template is a conditional request
to read strong sources with `web_extract`, treat retrieved text as evidence, and
identify unverified claims when reads fail. Both arms receive that same prompt;
tool descriptions and result schemas necessarily differ. The baseline search tool
also calls `openai/gpt-6.1-terra` through Gateway for each search, in addition to
the outer agent model. The runner records those extra calls and their reported
usage separately from `agentUsage`.

JSONL includes answers, tool calls/results, usage, elapsed time and failed runs.
Failure rows include the setup/inference stage and a redacted diagnostic; any
failed arm gives the process a nonzero exit code while preserving other rows.
Review claim correctness against the linked primary documentation. For each answer,
record supported factual claims / all factual claims, supported citations / all
citations, missing citations, and whether extracted text actually supports each
claim. Inspect tool results for provider choice, fallback and per-URL failures;
repeat with an unavailable provider to check error behavior. Do not infer fallback
merely because a final answer succeeded.

`totalCostUsd` is deliberately `null`. Reconcile agent inference, baseline search
inference plus search fees, and WebRouter provider charges using their respective
usage/billing records. Missing usage is unknown, not zero. Do not infer total cost
from outer-agent tokens alone. Keep run artifacts local unless reviewed for sharing.

### Validation recorded on 2026-11-25

Deterministic tests exercise the production launcher, tool filtering, credential-file
forwarding, and an agent search-to-extract-to-citation loop with a scripted model.
They also cover provider/startup errors, incomplete discovery, and comparison
failure reporting/redaction. These tests need neither Python nor a live model key.

A separate live run of the pinned WebRouter 0.15.0 package through Mastra MCPClient
2.11.0 found the official MCPClient reference using `exa-mcp`, then read that same
URL using `jina`. The extraction preserved the URL and returned markdown with
status 200 and a truncation flag. This verifies real tool calls and URL preservation;
it does not establish model answer quality or complete-page retrieval.

No Gateway credential was available for paired agent runs, so answer correctness,
citation coverage, comparative latency and total cost have not been measured.

### Local smoke results, 2026-11-25

| Check | Result |
| --- | --- |
| Concurrent production startup | Both callers received the same cached tools |
| Search, `exa-mcp` | 2 results, 1,176 ms |
| Extract, `jina` | Same source URL, HTTP 200, 3,605 ms, truncated |
| Automated tests, typecheck and build | 6 tests passed; typecheck and build passed |
| Paired agent citations, end-to-end latency and total cost | Not measured; Gateway credential required |

Timings are one local tool call each, measured at the Mastra client after discovery.
They exclude package installation and startup, and are not an agent benchmark or
an estimate of total cost. The source page was the official MCPClient reference
at `https://mastra.ai/reference/tools/mcp-client`.
