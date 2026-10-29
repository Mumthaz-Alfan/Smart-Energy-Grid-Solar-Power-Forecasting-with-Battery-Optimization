import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const frontendDir = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(frontendDir, '..')
const apiUrl = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'

function backendPlugin() {
  let backendProcess

  return {
    name: 'solaris-backend',
    async configureServer(server) {
      if (process.env.VITE_API_TARGET) return

      const statusUrl = `${apiUrl}/api/status`
      try {
        const response = await fetch(statusUrl)
        if (response.ok) return
      } catch {
        // The local API is not running yet; start it below.
      }

      const python = process.env.PYTHON
        || [
          resolve(projectRoot, '.venv', 'Scripts', 'python.exe'),
          resolve(projectRoot, 'venv', 'Scripts', 'python.exe'),
          resolve(projectRoot, '.venv', 'bin', 'python'),
          resolve(projectRoot, 'venv', 'bin', 'python'),
        ].find((candidate) => existsSync(candidate))
        || (process.platform === 'win32' ? 'python' : 'python3')

      backendProcess = spawn(
        python,
        ['-m', 'uvicorn', 'src.api.server:app', '--host', '127.0.0.1', '--port', '8000'],
        { cwd: projectRoot, stdio: 'inherit', windowsHide: true },
      )

      let startupError
      backendProcess.once('error', (error) => {
        startupError = error
      })

      const stopBackend = () => {
        if (backendProcess && backendProcess.exitCode === null) {
          backendProcess.kill()
        }
      }
      server.httpServer?.once('close', stopBackend)
      process.once('exit', stopBackend)

      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        if (startupError) {
          throw new Error(`Could not start the SOLARIS API with "${python}": ${startupError.message}`)
        }
        if (backendProcess.exitCode !== null) {
          throw new Error(`The SOLARIS API exited with code ${backendProcess.exitCode} during startup.`)
        }
        try {
          const response = await fetch(statusUrl)
          if (response.ok) return
        } catch {
          // Wait for Uvicorn to finish importing the application and bind its port.
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
      }

      stopBackend()
      throw new Error('The SOLARIS API did not become ready on port 8000 within 60 seconds.')
    },
  }
}

export default defineConfig({
  plugins: [react(), backendPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
