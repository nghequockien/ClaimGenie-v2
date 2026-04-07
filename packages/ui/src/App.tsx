import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/layout/Layout";
import DashboardPage from "./pages/DashboardPage";
import ClaimsPage from "./pages/ClaimsPage";
import ClaimDetailPage from "./pages/ClaimDetailPage";
import MonitoringPage from "./pages/MonitoringPage";
import NewClaimPage from "./pages/NewClaimPage";
import AgentConfigPage from "./pages/AgentConfigPage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import RequireAdmin from "./auth/RequireAdmin";
import RequireAuth from "./auth/RequireAuth";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="claims" element={<ClaimsPage />} />
          <Route path="claims/new" element={<NewClaimPage />} />
          <Route path="claims/:id" element={<ClaimDetailPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="monitoring" element={<MonitoringPage />} />
          <Route
            path="config"
            element={
              <RequireAdmin>
                <AgentConfigPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
