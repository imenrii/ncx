import { Component, type ReactNode } from "react";

/** A failed plot must not remove dataset navigation or the embedding session. */
export class PlotBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(cause: unknown) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
  render() {
    return this.state.error ? <div className="comparison-unavailable" role="alert">
      <p>{this.state.error}</p>
      <button onClick={() => this.setState({ error: undefined })}>Retry plot</button>
    </div> : this.props.children;
  }
}
