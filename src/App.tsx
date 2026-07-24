import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { useI18n } from "./i18n";

const AboutPage = lazy(() => import("./pages/AboutPage").then((module) => ({ default: module.AboutPage })));
const GuidePage = lazy(() => import("./pages/GuidePage").then((module) => ({ default: module.GuidePage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage })));
const StudioPage = lazy(() => import("./pages/StudioPage").then((module) => ({ default: module.StudioPage })));

export function App() {
  const { t } = useI18n();
  const routeFallback = <div className="route-loading">{t("正在加载 RunBeat…")}</div>;
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/studio" replace />} />
        <Route path="studio" element={<Suspense fallback={routeFallback}><StudioPage /></Suspense>} />
        <Route path="projects" element={<Suspense fallback={routeFallback}><ProjectsPage /></Suspense>} />
        <Route path="guide" element={<Suspense fallback={routeFallback}><GuidePage /></Suspense>} />
        <Route path="about" element={<Suspense fallback={routeFallback}><AboutPage /></Suspense>} />
      </Route>
    </Routes>
  );
}
