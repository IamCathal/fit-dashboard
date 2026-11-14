import { useTranslation } from "../lib/i18n";
import type { Activity, RecordPoint } from "../types";
import type { DistanceUnit, MapStyle, Theme, TimeFormat } from "../stores/settingsStore";
import { OverviewLocationMap } from "./OverviewLocationMap";
import { OverviewWeeklyTrend } from "./OverviewWeeklyTrend";
import { OverviewWeekSummary } from "./OverviewWeekSummary";
import { ActivityContributionHeatmap } from "./ActivityContributionHeatmap";
import { OverviewTrainingPattern } from "./OverviewTrainingPattern";
import { OverviewPersonalRecords } from "./OverviewPersonalRecords";
import { OverviewActivityTable } from "./OverviewActivityTable";
import { IconDistance, IconClock, IconAvg, IconBarChart } from "./icons";
import { formatDuration } from "../lib/activityFormat";

export type OverviewTimeframe = "all" | "1m" | "2m" | "3m" | "6m" | "1y";

export const OVERVIEW_TIMEFRAMES: OverviewTimeframe[] = ["all", "1m", "2m", "3m", "6m", "1y"];

type Props = {
  activities: Activity[];
  overviewFiltered: Activity[];
  overviewTimeframe: OverviewTimeframe;
  setOverviewTimeframe: (timeframe: OverviewTimeframe) => void;
  overviewMapRecords: RecordPoint[];
  overviewMapScope: Activity[];
  overviewMapFitScope: Activity[];
  mapStyle: MapStyle;
  setMapStyle: (style: MapStyle) => void;
  onSelectActivity: (activity: Activity) => void;
  totalDistance: number;
  totalDuration: number;
  avgDistance: number;
  distanceSuffix: string;
  distanceUnit: DistanceUnit;
  theme: Theme;
  selectedWeekStart: string | null;
  setSelectedWeekStart: (weekStart: string | null) => void;
  selectedWeekActivities: Activity[];
  timeFormat: TimeFormat;
};

export function OverviewView({
  activities,
  overviewFiltered,
  overviewTimeframe,
  setOverviewTimeframe,
  overviewMapRecords,
  overviewMapScope,
  overviewMapFitScope,
  mapStyle,
  setMapStyle,
  onSelectActivity,
  totalDistance,
  totalDuration,
  avgDistance,
  distanceSuffix,
  distanceUnit,
  theme,
  selectedWeekStart,
  setSelectedWeekStart,
  selectedWeekActivities,
  timeFormat,
}: Props) {
  const { t } = useTranslation();

  if (activities.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><IconBarChart size={40} /></span>
        <span>{t("overview.importLogsToSee")}</span>
      </div>
    );
  }

  return (
    <>
      <div className="overview-timeframe-filter">
        <span className="overview-timeframe-label">{t("overview.timeframe")}</span>
        <div className="overview-timeframe-options" role="group" aria-label={t("overview.timeframe")}>
          {OVERVIEW_TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              className={overviewTimeframe === tf ? "active" : ""}
              aria-pressed={overviewTimeframe === tf}
              onClick={() => setOverviewTimeframe(tf)}
            >
              {t(`overview.timeframe.${tf}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="overview-focus-row">
        <OverviewLocationMap
          records={overviewMapRecords}
          activities={overviewMapScope}
          fitActivities={overviewMapFitScope}
          mapStyle={mapStyle}
          setMapStyle={setMapStyle}
          onSelectActivity={onSelectActivity}
        />
        <div className="overview-side-stack">
          <div className="overview-compact-stats">
            <div className="stat-card"><div className="stat-icon"><IconDistance /></div><div className="stat-value">{totalDistance.toFixed(1)} <small>{distanceSuffix}</small></div><div className="stat-label">{t("overview.totalDistance")}</div></div>
            <div className="stat-card"><div className="stat-icon"><IconClock /></div><div className="stat-value">{formatDuration(totalDuration)}</div><div className="stat-label">{t("overview.totalDuration")}</div></div>
            <div className="stat-card"><div className="stat-icon"><IconAvg /></div><div className="stat-value">{avgDistance.toFixed(1)} <small>{distanceSuffix}</small></div><div className="stat-label">{t("overview.avgDistancePerActivity")}</div></div>
          </div>
          <OverviewWeeklyTrend
            activities={overviewFiltered}
            distanceUnit={distanceUnit}
            theme={theme}
            selectedWeekStart={selectedWeekStart}
            onSelectWeek={(weekStart) => setSelectedWeekStart(weekStart)}
          />
        </div>
      </div>
      {selectedWeekStart && (
        <OverviewWeekSummary
          weekStart={selectedWeekStart}
          activities={selectedWeekActivities}
          distanceUnit={distanceUnit}
          onSelectActivity={onSelectActivity}
          onClear={() => setSelectedWeekStart(null)}
        />
      )}
      <div className="overview-contribution-row">
        <div className="overview-contribution-main">
          <ActivityContributionHeatmap
            activities={overviewFiltered}
            highlightedWeekStart={selectedWeekStart}
            onSelectActivity={onSelectActivity}
          />
        </div>
        <div className="overview-contribution-side">
          <OverviewTrainingPattern activities={overviewFiltered} theme={theme} />
        </div>
      </div>
      <OverviewPersonalRecords
        activities={overviewFiltered}
        distanceUnit={distanceUnit}
        onSelectActivity={onSelectActivity}
      />
      <OverviewActivityTable activities={overviewFiltered} distanceUnit={distanceUnit} timeFormat={timeFormat} />
    </>
  );
}
