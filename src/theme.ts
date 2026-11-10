import { createTheme } from '@mui/material/styles'

// Plain MUI. Light and dark follow the device setting.
export const theme = createTheme({
  cssVariables: true,
  colorSchemes: { light: true, dark: true },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
  },
})
