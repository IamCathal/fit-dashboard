import appIcon from "../assets/app-icon.svg";
import { useTranslation } from "../lib/i18n";
import type { Theme } from "../stores/settingsStore";
import {
  IconMenu,
  IconSun,
  IconMoon,
  IconPaper,
  IconSettings,
  IconLogout,
} from "./icons";

export type DashboardTab = "overview" | "individual" | "compare";

type Props = {
  tab: DashboardTab;
  setTab: (tab: DashboardTab) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleSettings: () => void;
  onLogout: () => Promise<void>;
  supporterBadge: boolean;
  onToggleSidebar: () => void;
};

export function AppHeader({
  tab,
  setTab,
  theme,
  setTheme,
  toggleSettings,
  onLogout,
  supporterBadge,
  onToggleSidebar,
}: Props) {
  const { t } = useTranslation();

  return (
    <header className="app-header">
      <div className="header-left">
        <button className="icon-btn sidebar-toggle-btn" onClick={onToggleSidebar} aria-label={t("sidebar.toggleSidebar")}>
          <IconMenu />
        </button>
        <div className="brand">
          <div className="brand-icon"><img src={appIcon} alt="FIT Dashboard" className="brand-icon-img" /></div>
          <div className="brand-text">
            <h1>
              FIT Dashboard
              {supporterBadge && <span className="supporter-badge-inline" title="Supporter Badge Active">{t("header.supporter")}</span>}
            </h1>
            <span>{t("header.workoutLogAnalytics")}</span>
          </div>
        </div>
      </div>
      <div className="header-center">
        <div className="view-toggle">
          <button id="tab-overview" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{t("header.overview")}</button>
          <button id="tab-individual" className={tab === "individual" ? "active" : ""} onClick={() => setTab("individual")}>{t("header.individual")}</button>
          <button id="tab-compare" className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}>{t("header.compare")}</button>
        </div>
      </div>
      <div className="header-right">
        <button
          className="icon-btn"
          onClick={() => {
            if (theme === "paper" || theme === "paper-dark") {
              setTheme(theme === "paper-dark" ? "paper" : "paper-dark");
            } else {
              setTheme(theme === "dark" ? "light" : "dark");
            }
          }}
          aria-label="Toggle light or dark mode"
          title={theme === "dark" || theme === "paper-dark" ? t("header.lightMode") : t("header.darkMode")}
        >
          {theme === "dark" || theme === "paper-dark" ? <IconSun /> : <IconMoon />}
        </button>
        <button
          className={`icon-btn ${theme === "paper" || theme === "paper-dark" ? "active" : ""}`}
          onClick={() => {
            const isPaper = theme === "paper" || theme === "paper-dark";
            const isDark = theme === "dark" || theme === "paper-dark";
            setTheme(isPaper ? (isDark ? "dark" : "light") : (isDark ? "paper-dark" : "paper"));
          }}
          aria-label="Toggle paper theme"
          aria-pressed={theme === "paper" || theme === "paper-dark"}
          title={theme === "paper" || theme === "paper-dark" ? t("header.standardMode") : t("header.paperMode")}
        >
          <IconPaper />
        </button>
        <button className="icon-btn" onClick={toggleSettings} aria-label={t("header.settings")} title={t("header.settings")}><IconSettings /></button>
        <button className="icon-btn" onClick={() => void onLogout()} aria-label={t("header.logout")} title={t("header.logout")}><IconLogout /></button>
      </div>
    </header>
  );
}
