import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// BASE_PATH lets the same build run at the domain root (Netlify, custom domain)
// or under a GitHub Pages project path such as /naad-webapp/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  preview: { port: 4173 },
})
