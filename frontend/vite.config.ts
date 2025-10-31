import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true,          // 讓外部能連（重要）
    port: 5173,          // 依你的實際 port
    proxy: {
      "/api": {
        target: "http://localhost:5000", // 你的後端 port
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
})
