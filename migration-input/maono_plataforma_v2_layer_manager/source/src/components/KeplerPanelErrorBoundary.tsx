import React from "react";

type Props = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type State = {
  hasError: boolean;
  error?: unknown;
};

export class KeplerPanelErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: any) {
    // ✅ loga stack real sem derrubar app inteira
    console.error("[KeplerPanelErrorBoundary] captured error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="h-full w-full bg-gray-900 text-white p-4">
            <div className="text-sm font-semibold mb-2">Painel temporariamente indisponível</div>
            <div className="text-xs text-gray-400">
              Ocorreu um erro ao renderizar o painel do Kepler. Verifique o Console para o stack trace.
            </div>
            <button
              type="button"
              className="mt-4 text-xs px-3 py-2 rounded bg-blue-600 hover:bg-blue-500"
              onClick={() => this.setState({ hasError: false, error: undefined })}
            >
              Tentar novamente
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
