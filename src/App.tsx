import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { APP } from './app.config.ts'

export default function App() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
      <Stack spacing={3}>
        <Typography variant="overline" color="text.secondary">
          {APP.host}
        </Typography>
        <Typography variant="h3" component="h1">
          {APP.title}
        </Typography>
        <Card>
          <CardContent>
            <Typography>Scaffolded by the launchpad. Replace this page with the app.</Typography>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  )
}
