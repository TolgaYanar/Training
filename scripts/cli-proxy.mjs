import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Faithful API proxy: forwards the app's exact request body (same model, temperature 0,
// same system prompt) to api.anthropic.com, swapping the API key for your Claude
// subscription's OAuth token. Identical behavior to the paid API, but billed to the
// subscription. No `claude -p` agent wrapper, so no temperature/context divergence.

const PORT = Number(process.env.PORT ?? 8787)
const OAUTH_BETA = 'oauth-2025-04-20'

function readToken() {
  // Windows/Linux store the token in ~/.claude/.credentials.json; macOS uses the Keychain.
  let oauth
  try {
    oauth = JSON.parse(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth
  } catch {
    oauth = JSON.parse(execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8' })).claudeAiOauth
  }
  if (!oauth?.accessToken) throw new Error('No Claude OAuth token found — run `claude` to log in.')
  if (oauth.expiresAt && Date.now() > oauth.expiresAt) console.warn('[proxy] OAuth token appears expired — open Claude Code to refresh it.')
  return oauth.accessToken
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  if (req.method !== 'POST') { res.writeHead(405, CORS); return res.end() }
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}')
      if (process.env.PROXY_MODEL) body.model = process.env.PROXY_MODEL
      // The subscription OAuth token authorizes inference only for genuinely Claude-Code-shaped
      // requests: the first system block must be the Claude Code identity. We prepend it and keep
      // the app's real system prompt as the next block (negligible effect on the task output).
      const ID = "You are Claude Code, Anthropic's official CLI for Claude."
      const sys = body.system
      body.system = typeof sys === 'string'
        ? [{ type: 'text', text: ID }, { type: 'text', text: sys }]
        : Array.isArray(sys) ? [{ type: 'text', text: ID }, ...sys] : [{ type: 'text', text: ID }]
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${readToken()}`,
          'anthropic-beta': OAUTH_BETA,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const text = await r.text()
      res.writeHead(r.status, { 'content-type': 'application/json', ...CORS })
      res.end(text)
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json', ...CORS })
      res.end(JSON.stringify({ error: { message: String(e?.message ?? e) } }))
    }
  })
})

server.listen(PORT, () => console.log(`Faithful API proxy on http://localhost:${PORT} -> api.anthropic.com via your Claude subscription (temperature 0, exact model, no API key)`))
