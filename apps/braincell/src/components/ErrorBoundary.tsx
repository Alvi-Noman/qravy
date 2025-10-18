import React from 'react';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
};

/**
 * ErrorBoundary component to catch runtime errors in its child component tree.
 * Displays a fallback UI when an error occurs.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Mark as used to satisfy @typescript-eslint/no-unused-vars
    void error;
    void errorInfo;
    // Integrate your error reporting service here if needed
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
            <h2 className="text-2xl font-bold mb-4 text-red-600">Something went wrong.</h2>
            <p className="mb-2">Please try refreshing the page or contact support.</p>
            {import.meta.env.MODE !== 'production' && this.state.error && (
              <pre className="text-xs text-left mt-4 text-gray-500">{this.state.error.message}</pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}