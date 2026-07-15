import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('App crash:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-6 whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-4 font-mono text-xs text-red-900">
          <h2 className="mb-2 font-bold">App crashed</h2>
          {this.state.error.stack || this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
