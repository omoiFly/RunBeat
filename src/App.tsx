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
  return (
    <Suspense fallback={<div className="route-loading">{t("正在加载 RunBeat…")}</div>}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/studio" replace />} />
          <Route path="studio" element={<StudioPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route path="about" element={<AboutPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
