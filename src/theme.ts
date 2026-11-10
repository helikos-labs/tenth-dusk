import { createTheme } from '@mui/material/styles'

// The game is dark at dusk whatever the device's setting: CssBaseline paints the page in the Hush's colour, in the UI
// face (Barlow Semi Condensed, loaded from Google Fonts in index.html). The screens style themselves (ui/screens.css).
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#ff9a4a' },
    background: { default: '#0b0e14', paper: '#11151d' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Barlow Semi Condensed", "Arial Narrow", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
  },
})
