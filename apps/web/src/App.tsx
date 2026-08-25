import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CopilotPage } from './pages/CopilotPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { OverviewPage } from './pages/OverviewPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="copilot" element={<CopilotPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
