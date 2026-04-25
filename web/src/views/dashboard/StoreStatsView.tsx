import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import Chart from "react-apexcharts";
import { useTheme } from "@/context/theme-provider";
import { isMobileOnly } from "react-device-detect";
import { Event } from "@/types/event";
import { FrigateConfig } from "@/types/frigateConfig";
import { useFrigateEvents } from "@/api/ws";
import { MdCircle } from "react-icons/md";
import type { FrigateEvent } from "@/types/ws";

const GRAPH_COLORS = ["#5C7CFA", "#ED5CFA", "#FAD75C", "#5CFAB3", "#FA5C7C", "#5CB8FA"];

function todayMidnightTimestamp(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

function stateToEvent(after: FrigateEvent["after"]): Event {
  return {
    id: after.id,
    label: after.label,
    camera: after.camera,
    start_time: after.start_time,
    end_time: after.end_time ?? undefined,
    false_positive: after.false_positive,
    zones: after.entered_zones,
    thumbnail: after.thumbnail ?? "",
    has_clip: after.has_clip,
    has_snapshot: after.has_snapshot,
    retain_indefinitely: false,
    data: {
      top_score: after.top_score,
      score: after.score,
      region: after.region,
      box: after.box,
      area: after.area,
      ratio: after.ratio,
      type: "object",
      path_data: [],
    },
  };
}

type Panel = {
  title: string;
  cameras: string[];
  zones?: string[];
};

// Returns per-minute occupancy series for a panel's cameras/zones
function buildPanelSeries(
  panel: Panel,
  events: Event[],
  todayMidnight: number,
): { series: ApexAxisChartSeries; timestamps: number[] } {
  const nowSeconds = Date.now() / 1000;
  const minutesElapsed = Math.max(1, Math.floor((nowSeconds - todayMidnight) / 60));

  const timestamps: number[] = [];
  for (let m = 0; m <= minutesElapsed; m++) {
    timestamps.push((todayMidnight + m * 60) * 1000);
  }

  const panelEvents = events.filter((e) => {
    if (!panel.cameras.includes(e.camera)) return false;
    if (panel.zones && panel.zones.length > 0) {
      return panel.zones.some((z) => e.zones.includes(z));
    }
    return true;
  });

  // Group by camera (or by zone if zones are specified)
  const groupKeys = panel.zones && panel.zones.length > 0 ? panel.zones : panel.cameras;

  const series: ApexAxisChartSeries = groupKeys.map((key, idx) => {
    const keyEvents = panel.zones && panel.zones.length > 0
      ? panelEvents.filter((e) => e.zones.includes(key))
      : panelEvents.filter((e) => e.camera === key);

    const data = timestamps.map((ts) => {
      const bucketStart = ts / 1000;
      const bucketEnd = bucketStart + 60;
      const count = keyEvents.filter((e) => {
        return e.start_time < bucketEnd && (e.end_time == null ? true : e.end_time > bucketStart);
      }).length;
      return { x: ts, y: count };
    });

    return { name: key, data, color: GRAPH_COLORS[idx % GRAPH_COLORS.length] };
  });

  return { series, timestamps };
}

type OccupancyGraphProps = {
  graphId: string;
  panel: Panel;
  events: Event[];
  todayMidnight: number;
  chartOptions: ApexCharts.ApexOptions;
};

function OccupancyGraph({ graphId, panel, events, todayMidnight, chartOptions }: OccupancyGraphProps) {
  const { series, timestamps } = useMemo(
    () => buildPanelSeries(panel, events, todayMidnight),
    [panel, events, todayMidnight],
  );

  const lastValues = useMemo(
    () => series.map((s) => (s.data as { x: number; y: number }[])[s.data.length - 1]?.y ?? 0),
    [series],
  );

  const options = useMemo(
    () => ({ ...chartOptions, chart: { ...chartOptions.chart, id: graphId } }),
    [chartOptions, graphId],
  );

  const fallbackSeries = [{ name: "Occupancy", data: timestamps.map((ts) => ({ x: ts, y: 0 })) }];

  return (
    <div className="rounded-lg bg-background_alt p-2.5 md:rounded-2xl">
      <div className="mb-5 text-sm font-medium">{panel.title}</div>
      {series.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          {series.map((s, idx) => (
            <div key={s.name as string} className="flex items-center gap-1">
              <MdCircle
                className="size-2"
                style={{ color: GRAPH_COLORS[idx % GRAPH_COLORS.length] }}
              />
              <span className="text-xs text-secondary-foreground">{s.name as string}</span>
              <span className="text-xs text-primary">{lastValues[idx]}</span>
            </div>
          ))}
        </div>
      )}
      <Chart
        type="line"
        options={options}
        series={series.length > 0 ? series : fallbackSeries}
        height={120}
      />
    </div>
  );
}

export default function StoreStatsView() {
  const { theme, systemTheme } = useTheme();
  const resolvedTheme = systemTheme || theme;

  const { data: config } = useSWR<FrigateConfig>("config", {
    revalidateOnFocus: false,
  });

  // All detection-enabled cameras ordered by ui.order
  const detectionCameras = useMemo(() => {
    if (!config) return [];
    return Object.values(config.cameras)
      .filter((c) => c.enabled_in_config && c.detect?.enabled)
      .sort((a, b) => a.ui.order - b.ui.order)
      .map((c) => c.name);
  }, [config]);

  // Resolve panels: use config if present, otherwise one panel per camera
  const panels = useMemo<Panel[]>(() => {
    if (!config) return [];
    const configured = config.dashboard?.panels;
    if (configured && configured.length > 0) {
      return configured.map((p) => ({
        title: p.title,
        cameras: p.cameras ?? detectionCameras,
        zones: p.zones ?? undefined,
      }));
    }
    return detectionCameras.map((cam) => ({ title: cam, cameras: [cam] }));
  }, [config, detectionCameras]);

  // Union of all cameras referenced by any panel
  const allTrackedCameras = useMemo(
    () => Array.from(new Set(panels.flatMap((p) => p.cameras))),
    [panels],
  );

  const todayMidnight = useMemo(() => todayMidnightTimestamp(), []);

  // Fetch today's person events once — WS keeps state current
  const { data: initialEvents } = useSWR<Event[]>(
    allTrackedCameras.length > 0
      ? `events?label=person&after=${Math.floor(todayMidnight)}&limit=5000`
      : null,
    { revalidateOnFocus: false },
  );

  // Local event map keyed by id, seeded from REST then patched by WS
  const [eventsById, setEventsById] = useState<Record<string, Event>>({});
  const seededRef = useRef(false);

  useEffect(() => {
    if (!initialEvents || seededRef.current) return;
    seededRef.current = true;
    const map: Record<string, Event> = {};
    initialEvents.forEach((e) => {
      if (allTrackedCameras.includes(e.camera)) map[e.id] = e;
    });
    setEventsById(map);
  }, [initialEvents, allTrackedCameras]);

  const { payload: wsEvent } = useFrigateEvents();
  useEffect(() => {
    if (!wsEvent) return;
    const { type, after } = wsEvent;
    if (after.label !== "person") return;
    if (!allTrackedCameras.includes(after.camera)) return;
    if (after.start_time < todayMidnight) return;

    setEventsById((prev) => {
      if (type === "end") {
        return {
          ...prev,
          [after.id]: {
            ...(prev[after.id] ?? stateToEvent(after)),
            end_time: after.end_time ?? undefined,
          } as Event,
        };
      }
      return { ...prev, [after.id]: stateToEvent(after) };
    });
  }, [wsEvent, allTrackedCameras, todayMidnight]);

  const events = useMemo(() => Object.values(eventsById), [eventsById]);

  const chartOptions = useMemo(
    (): ApexCharts.ApexOptions => ({
      chart: {
        selection: { enabled: false },
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: false },
      },
      grid: { show: false },
      legend: { show: false },
      dataLabels: { enabled: false },
      stroke: { width: 1, curve: "smooth" },
      tooltip: { theme: resolvedTheme, x: { format: "HH:mm" } },
      markers: { size: 0 },
      xaxis: {
        type: "datetime",
        tickAmount: isMobileOnly ? 2 : 4,
        labels: {
          datetimeUTC: false,
          format: "HH:mm",
          rotate: 0,
          style: { colors: "#6B6B6B", fontSize: "11px" },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          formatter: (val) => Math.ceil(val).toString(),
          style: { colors: "#6B6B6B" },
        },
        min: 0,
      },
    }),
    [resolvedTheme],
  );

  return (
    <div className="scrollbar-container mt-4 flex size-full flex-col gap-3 overflow-y-auto px-4">
      <div className="text-sm font-medium text-muted-foreground">
        Store Statistics
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {panels.map((panel, idx) => (
          <OccupancyGraph
            key={panel.title + idx}
            graphId={`dashboard-panel-${idx}`}
            panel={panel}
            events={events}
            todayMidnight={todayMidnight}
            chartOptions={chartOptions}
          />
        ))}
      </div>
    </div>
  );
}
