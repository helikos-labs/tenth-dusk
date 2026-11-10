// The error boundary around the game and its scene (R25): a render error anywhere below (the world failing to set up
// WebGL included) shows a calm screen in place of a blank page. "Return to title" remounts the game, which reads the
// save afresh, so the journey can be continued.
import { Component, Fragment, type ReactNode } from 'react'
import Calm from './Calm.tsx'

interface GuardState {
  failed: boolean
  /** Bumped on "Return to title": the game below remounts. */
  n: number
}

export default class Guard extends Component<{ children: ReactNode }, GuardState> {
  state: GuardState = { failed: false, n: 0 }

  static getDerivedStateFromError(): Partial<GuardState> {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <Calm
          heading="The way grows dark"
          text="Something went wrong while drawing the world. Your journey is kept."
          onReturn={() => this.setState((s) => ({ failed: false, n: s.n + 1 }))}
        />
      )
    }
    return <Fragment key={this.state.n}>{this.props.children}</Fragment>
  }
}
