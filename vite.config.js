import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serves the api/ functions during `npm run dev`, so local development
 * doesn't need the Vercel CLI. In production Vercel runs api/*.js itself.
 */
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/parse-rule', async (req, res) => {
        try {
          const { default: handler } = await server.ssrLoadModule('/api/parse-rule.js')
          await handler(req, res)
        } catch (err) {
          server.ssrFixStacktrace(err)
          console.error(err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: 'DEV_SERVER_ERROR', message: err.message }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Make the LLM keys from .env / .env.local visible to the api handler.
  const env = loadEnv(mode, process.cwd(), '')
  for (const name of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'GROQ_MODEL']) {
    if (env[name] && !process.env[name]) process.env[name] = env[name]
  }

  return {
    plugins: [react(), localApi()],
    test: { include: ['tests/**/*.test.js'] },
  }
})
