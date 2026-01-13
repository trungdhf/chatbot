import { useEffect, useState } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import {
  FunctionDeclaration,
  LiveServerToolCall,
  Modality,
  Type,
} from "@google/genai";
import "./schedule.scss";

const declaration: FunctionDeclaration = {
  name: "get_schedule_details",
  description:
    "Looks up a person's schedule from the public/schedule file and returns details for a date or range.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: "Full display name to search (exact match preferred)",
      },
      date: {
        type: Type.STRING,
        description:
          "Specific date in YYYY-MM-DD. If provided, return that day only.",
      },
      start_date: {
        type: Type.STRING,
        description:
          "Start of range in YYYY-MM-DD. Use with end_date to return a range.",
      },
      end_date: {
        type: Type.STRING,
        description:
          "End of range in YYYY-MM-DD. Use with start_date to return a range.",
      },
    },
    required: ["name"],
  },
};

const updateDeclaration: FunctionDeclaration = {
  name: "update_schedule",
  description: "Creates or updates a person's schedule entry for a specific date.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Display name to update. Defaults to チュン when omitted" },
      date: { type: Type.STRING, description: "Target date YYYY-MM-DD" },
      workType: { type: Type.STRING, description: "Work type label" },
      content: { type: Type.STRING, description: "Free text details" },
      operation: { type: Type.STRING, description: "set|clear (default set)" },
    },
    required: ["date"],
  },
};

async function fetchSchedule() {
  const res = await fetch("/shedule.txt");
  if (!res.ok) {
    throw new Error(`Failed to fetch schedule: ${res.status}`);
  }
  return (await res.json()) as {
    dates: string[];
    users: Array<{
      name: string;
      schedule: Record<
        string,
        { date: string; workType: string; content: string }
      >;
    }>;
  };
}

function filterByDateRange(
  entries: Record<string, { date: string; workType: string; content: string }>,
  date?: string,
  start?: string,
  end?: string
) {
  const keys = Object.keys(entries);
  if (date) {
    return entries[date] ? [{ ...entries[date] }] : [];
  }
  if (start && end) {
    const s = start;
    const e = end;
    return keys
      .filter((d) => d >= s && d <= e)
      .map((d) => entries[d])
      .filter(Boolean);
  }
  return keys.map((d) => entries[d]).filter(Boolean);
}

export default function ScheduleAssistant() {
  const { client, setConfig, setModel } = useLiveAPIContext();
  const [displayName, setDisplayName] = useState<string>("");
  const [calendarWeeks, setCalendarWeeks] = useState<
    Array<
      Array<{
        date: string;
        inMonth: boolean;
        workType?: string;
        content?: string;
        isToday?: boolean;
      }>
    >
  >([]);
  const [calendarTitle, setCalendarTitle] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [quickWorkType, setQuickWorkType] = useState<string>("");
  const [quickContent, setQuickContent] = useState<string>("");

  const loadSchedule = async () => {
    const cached = localStorage.getItem("schedule.json");
    if (cached) {
      return JSON.parse(cached);
    }
    return await fetchSchedule();
  };

  const persistSchedule = (data: any) => {
    localStorage.setItem("schedule.json", JSON.stringify(data));
  };

  const downloadSchedule = (data: any) => {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shedule.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const toISO = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const buildCalendar = (
    schedule: Record<string, { date: string; workType: string; content: string }>,
    targetDate: string
  ) => {
    const base = new Date(`${targetDate}T00:00:00`);
    const y = base.getFullYear();
    const m = base.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const title = `${y}-${String(m + 1).padStart(2, "0")}`;
    const cells: Array<{
      date: string;
      inMonth: boolean;
      workType?: string;
      content?: string;
      isToday?: boolean;
    }> = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toISO(d);
      const inMonth = d.getMonth() === m;
      const entry = schedule[iso];
      cells.push({
        date: iso,
        inMonth,
        workType: entry?.workType,
        content: entry?.content,
        isToday: iso === toISO(new Date()),
      });
    }
    const weeks: typeof calendarWeeks = [];
    for (let i = 0; i < 6; i++) {
      weeks.push(cells.slice(i * 7, i * 7 + 7));
    }
    setCalendarTitle(title);
    setCalendarWeeks(weeks);
  };

  useEffect(() => {
    setModel("models/gemini-2.0-flash-exp");
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const todayIso = toISO(now);
    setConfig({
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Fenrir" } },
      },
      systemInstruction: {
        parts: [
          {
            text:
              'You are a helpful assistant. For schedule queries call "get_schedule_details" with name and optional date/range. For changes call "update_schedule" with name, date, workType, and content. If the user says "my schedule" or omits name, default to チュン. If name not found, use nearest match. Offer concise selectable options in replies when appropriate.',
          },
          {
            text: `Current date: ${todayIso}. Current time: ${now.toISOString()}. Time zone: ${tz}. Use today when the user asks for "today" or current week.`,
          },
          {
            text:
              "必ず日本語で返答し、日本語で音声応答も行ってください。短く明確に説明し、必要な場合は表や箇条書きで整理してください。",
          },
        ],
      },
      tools: [{ functionDeclarations: [declaration, updateDeclaration] }],
    });
  }, [setConfig, setModel]);

  useEffect(() => {
    const onToolCall = async (toolCall: LiveServerToolCall) => {
      const fcs = toolCall.functionCalls || [];
      const getCalls = fcs.filter((fc) => fc.name === declaration.name);
      const updateCalls = fcs.filter((fc) => fc.name === updateDeclaration.name);
      if (!getCalls.length && !updateCalls.length) return;

      try {
        const schedule = await loadSchedule();
        const responses: any[] = [];

        getCalls.forEach((fc) => {
          const args = (fc.args || {}) as any;
          const nameArg: string = args.name || "チュン";
          const dateArg: string | undefined = args.date;
          const startArg: string | undefined = args.start_date;
          const endArg: string | undefined = args.end_date;
          const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
          const normArg = norm(nameArg);

          const person = schedule.users.find((u: any) =>
            norm(u.name) === normArg || norm(u.name).includes(normArg)
          );

          const results = person
            ? filterByDateRange(person.schedule, dateArg, startArg, endArg)
            : [];

          setDisplayName(person?.name || nameArg);

          const target =
            dateArg || startArg || (results[0]?.date as string) || toISO(new Date());
          if (person?.schedule) {
            buildCalendar(person.schedule, target);
          } else {
            setCalendarWeeks([]);
            setCalendarTitle("");
          }

          responses.push({
            response: {
              output: {
                success: true,
                name: nameArg,
                count: results.length,
                results,
                source: "/shedule.txt",
              },
            },
            id: fc.id!,
            name: fc.name!,
          });
        });

        updateCalls.forEach((fc) => {
          const args = (fc.args || {}) as any;
          const nameArg: string = args.name || "チュン";
          const dateArg: string = args.date;
          const workTypeArg: string = args.workType || "";
          const contentArg: string = args.content || "";
          const op: string = (args.operation || "set").toLowerCase();
          const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
          const normArg = norm(nameArg);

          let person = schedule.users.find((u: any) => norm(u.name) === normArg || norm(u.name).includes(normArg));
          if (!person) {
            person = { name: nameArg, schedule: {} };
            schedule.users.push(person);
          }

          if (op === "clear") {
            delete person.schedule[dateArg];
          } else {
            person.schedule[dateArg] = {
              date: dateArg,
              workType: workTypeArg,
              content: contentArg,
            };
          }

          persistSchedule(schedule);
          setDisplayName(person.name);
          setSelectedDate(dateArg);
          buildCalendar(person.schedule, dateArg);

          responses.push({
            response: {
              output: {
                success: true,
                updated: { name: person.name, date: dateArg, workType: workTypeArg, content: contentArg, operation: op },
                source: "localStorage(schedule.json)",
              },
            },
            id: fc.id!,
            name: fc.name!,
          });
        });

        client.sendToolResponse({ functionResponses: responses });
      } catch (e: any) {
        const responses = [...getCalls, ...updateCalls].map((fc) => ({
          response: {
            output: {
              success: false,
              error: e?.message || String(e),
            },
          },
          id: fc.id!,
          name: fc.name!,
        }));
        client.sendToolResponse({ functionResponses: responses });
      }
    };

    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client, buildCalendar]);

  return (
    <div className="schedule-container">
      {calendarWeeks.length ? (
        <div>
          <h3 className="calendar-title">{displayName} {calendarTitle}</h3>
          <table className="calendar-table">
            <thead>
              <tr>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calendarWeeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`${cell.inMonth ? "in-month" : "out-month"} ${cell.isToday ? "today" : ""}`}
                      onClick={() => setSelectedDate(cell.date)}
                    >
                      <div className="day-number">{cell.date.slice(-2)}</div>
                      {cell.workType ? <div className="badge work-type">{cell.workType}</div> : ""}
                      {cell.content ? <div className="content">{cell.content}</div> : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="quick-actions">
            <div className="row">
              <span className="label">Selected:</span>
              <span className="value">{selectedDate || toISO(new Date())}</span>
            </div>
            <div className="row">
              <button className="chip" onClick={() => setQuickWorkType("8:30出社")}>8:30出社</button>
              <button className="chip" onClick={() => setQuickWorkType("10:00出社")}>10:00出社</button>
              <button className="chip" onClick={() => setQuickWorkType("直行/直帰")}>直行/直帰</button>
              <button className="chip" onClick={() => setQuickWorkType("休暇")}>休暇</button>
            </div>
            <div className="row">
              <input className="input" placeholder="Work type" value={quickWorkType} onChange={(e) => setQuickWorkType(e.target.value)} />
            </div>
            <div className="row">
              <textarea className="input" placeholder="Content" value={quickContent} onChange={(e) => setQuickContent(e.target.value)} />
            </div>
            <div className="buttons">
              <button
                className="apply"
                onClick={async () => {
                  const sched = await loadSchedule();
                  const nameArg = displayName || "チュン";
                  const dateArg = selectedDate || toISO(new Date());
                  let person = sched.users.find((u: any) => u.name === nameArg);
                  if (!person) {
                    person = { name: nameArg, schedule: {} };
                    sched.users.push(person);
                  }
                  person.schedule[dateArg] = { date: dateArg, workType: quickWorkType, content: quickContent };
                  persistSchedule(sched);
                  buildCalendar(person.schedule, dateArg);
                }}
              >
                Apply
              </button>
              <button className="download" onClick={async () => downloadSchedule(await loadSchedule())}>Download</button>
            </div>
          </div>
        </div>
      ) : (
        ""
      )}
    </div>
  );
}

