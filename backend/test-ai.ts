export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);
    if (url.pathname === '/test-ai') {
      try {
        const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [{ role: 'user', content: 'What is 2+2? Answer in one word.' }],
          max_tokens: 10,
          temperature: 0,
        });
        return new Response(JSON.stringify({ ok: true, result }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('not found', { status: 404 });
  },
};
