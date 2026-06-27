try {
  var t = localStorage.getItem('cyphras_theme')
  var isDark =
    t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (isDark) {
    document.documentElement.classList.add('dark')
    document.documentElement.style.background = 'oklch(0.145 0 0)'
  } else {
    document.documentElement.style.background = 'oklch(0.96 0 0)'
  }
} catch {}
