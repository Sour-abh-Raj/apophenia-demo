import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/Home";
import { HostCreatePage } from "./pages/HostCreate";
import { HostDashboardPage } from "./pages/HostDashboard";
import { ParticipantPage } from "./pages/Participant";
import { ProjectorPage } from "./pages/Projector";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/j/:code" element={<ParticipantPage />} />
        <Route path="/host" element={<HostCreatePage />} />
        <Route path="/host/:sid" element={<HostDashboardPage />} />
        <Route path="/screen/:sid" element={<ProjectorPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
