import { Component, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/Home";
import { ParticipantPage } from "./pages/Participant";

// Students only download the pages they use; instructor and projector code (incl. the QR library) loads on demand.
const HostCreatePage = lazy(() => import("./pages/HostCreate").then((m) => ({ default: m.HostCreatePage })));
const HostDashboardPage = lazy(() => import("./pages/HostDashboard").then((m) => ({ default: m.HostDashboardPage })));
const ProjectorPage = lazy(() => import("./pages/Projector").then((m) => ({ default: m.ProjectorPage })));

/** If a page chunk fails to load (e.g. the app was redeployed while the tab was open), reload once to get the new version. */
class ChunkErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    try {
      if (!sessionStorage.getItem("apl:reloaded")) { sessionStorage.setItem("apl:reloaded", "1"); window.location.reload(); }
    } catch { /* storage blocked: show the message below */ }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="page narrow"><div className="card"><h2>Something went wrong loading this page.</h2><p>Please refresh the page. Your answers are saved on the server.</p></div></div>;
  }
}

const Loading = () => <div className="page narrow"><div className="card muted">Loading…</div></div>;

export function App() {
  return (
    <BrowserRouter>
      <ChunkErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/j/:code" element={<ParticipantPage />} />
            <Route path="/host" element={<HostCreatePage />} />
            <Route path="/host/:sid" element={<HostDashboardPage />} />
            <Route path="/screen/:sid" element={<ProjectorPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </Suspense>
      </ChunkErrorBoundary>
    </BrowserRouter>
  );
}
