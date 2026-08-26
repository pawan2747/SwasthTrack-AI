"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Calendar,
  Filter,
  HeartPulse,
  Moon,
  Pill,
  Scale,
  Utensils,
} from "lucide-react";
import { DepthCard } from "@/components/ui/depth-card";
import { TimelineEventCard } from "./timeline-event-card";
import { cn } from "@/lib/utils";
import {
  getHealthTimelineEvents,
  type TimelineDomain,
  type TimelineGroup,
} from "@/services/timeline-service";

type TimelineViewProps = {
  patientId: string;
};

const filterTabs: { id: "all" | TimelineDomain; label: string; hindiLabel: string; icon: typeof Activity }[] = [
  { id: "all", label: "All", hindiLabel: "सभी", icon: Filter },
  { id: "bp", label: "BP", hindiLabel: "रक्तचाप", icon: HeartPulse },
  { id: "medicine", label: "Meds", hindiLabel: "दवाइयाँ", icon: Pill },
  { id: "food", label: "Food", hindiLabel: "भोजन", icon: Utensils },
  { id: "activity", label: "Steps", hindiLabel: "कदम", icon: Activity },
  { id: "sleep", label: "Sleep", hindiLabel: "नींद", icon: Moon },
  { id: "weight", label: "Weight", hindiLabel: "वजन", icon: Scale },
];

export function TimelineView({ patientId }: TimelineViewProps) {
  const [activeFilter, setActiveFilter] = useState<"all" | TimelineDomain>("all");
  const [groups, setGroups] = useState<TimelineGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 25;

  useEffect(() => {
    let active = true;

    getHealthTimelineEvents(patientId, activeFilter, 0, LIMIT)
      .then((res) => {
        if (active) {
          setGroups(res.groups);
          setHasMore(res.hasMore);
          setOffset(0);
        }
      })
      .catch((err) => console.error("Timeline error:", err))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [patientId, activeFilter]);

  async function handleLoadMore() {
    setLoadingMore(true);
    const nextOffset = offset + LIMIT;
    try {
      const res = await getHealthTimelineEvents(patientId, activeFilter, nextOffset, LIMIT);
      setGroups(res.groups);
      setOffset(nextOffset);
      setHasMore(res.hasMore);
    } catch (err) {
      console.error("Load more error:", err);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* FILTER CHIPS (MOBILE HORIZONTAL SCROLL) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none">
        {filterTabs.map((tab) => {
          const isActive = activeFilter === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFilter(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 shadow-2xs",
                isActive
                  ? "bg-emerald-600 text-white shadow-xs scale-[1.02]"
                  : "bg-white border-2 border-slate-200 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/40"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.hindiLabel}</span>
              <span className="text-[10px] font-bold opacity-80">({tab.label})</span>
            </button>
          );
        })}
      </div>

      {/* TIMELINE CONTENT */}
      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-28 rounded-2xl bg-slate-100" />
          <div className="h-28 rounded-2xl bg-slate-100" />
          <div className="h-28 rounded-2xl bg-slate-100" />
        </div>
      ) : groups.length === 0 ? (
        <DepthCard depth={1} className="p-8 text-center bg-white rounded-2xl border-2 border-slate-200">
          <Calendar className="mx-auto h-10 w-10 text-slate-300 mb-2" />
          <h4 className="text-base font-black text-slate-800">कोई रिकॉर्ड नहीं मिला</h4>
          <p className="text-xs font-bold text-slate-500 mt-1">
            चुनी गई श्रेणी के लिए अभी कोई इवेंट दर्ज नहीं है।
          </p>
        </DepthCard>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.groupKey} className="space-y-3">
              {/* GROUP SECTION HEADER */}
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 shadow-2xs" />
                <h3 className="text-sm sm:text-base font-black text-slate-950 tracking-tight">
                  {group.groupLabelHi}
                </h3>
                <span className="text-xs font-bold text-slate-400">
                  · {group.events.length} इवेंट्स
                </span>
              </div>

              {/* EVENTS LIST */}
              <div className="space-y-2.5">
                {group.events.map((event) => (
                  <TimelineEventCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          ))}

          {/* LOAD MORE BUTTON */}
          {hasMore && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-6 py-2.5 rounded-xl bg-white border-2 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 active:scale-98 text-xs sm:text-sm font-black text-slate-800 shadow-sm cursor-pointer transition-all disabled:opacity-50"
              >
                {loadingMore ? "लोड हो रहा है..." : "पूर्व के और रिकॉर्ड्स देखें (Load More)"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
