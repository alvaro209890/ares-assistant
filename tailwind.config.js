/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta HUD: ciano/azul elétrico sobre fundo profundo.
        ares: {
          cyan: '#38e1ff',
          blue: '#2b6cff',
          deep: '#04070f',
          panel: 'rgba(12, 22, 38, 0.55)',
          edge: 'rgba(86, 200, 255, 0.25)'
        }
      },
      fontFamily: {
        display: ['Orbitron', 'Rajdhani', 'system-ui', 'sans-serif'],
        sans: ['Rajdhani', 'Inter', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        glow: '0 0 24px rgba(56, 225, 255, 0.35)',
        'glow-lg': '0 0 60px rgba(56, 225, 255, 0.45)'
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { opacity: '0.35', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.04)' }
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        }
      },
      animation: {
        'pulse-ring': 'pulse-ring 3.2s ease-in-out infinite',
        scan: 'scan 6s linear infinite'
      }
    }
  },
  plugins: []
}
