if (process.argv.some(arg => arg.endsWith('compare-web.ts'))) {
  process.env.MASTRA_GATEWAY_API_KEY = 'fixture-credential';
  // Discovery must fail locally rather than starting an installed Python server.
  process.env.PATH = '';
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: 'fixture-credential invalid request', type: 'invalid_request_error' },
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}
