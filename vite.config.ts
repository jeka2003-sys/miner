import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Оставляем base: './' для правильного построения относительных путей в продакшене.
  base: './', 
})