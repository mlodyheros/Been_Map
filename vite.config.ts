import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // relative asset URLs, so the build works under any path (GitHub Pages serves it from /Been_Map/)
  base: './',
  plugins: [react()],
})
