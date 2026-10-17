import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download } from "lucide-react";
import { AppShell, Chip } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { useTodos, useTutorSessions } from "@/api/hooks";
import { DataView, EmptyState } from "@/components/fr/states";
import { api } from "@/api";

export const Route = createFileRoute("/tutor")({
  head: () => meta("Tutor & course", "Tutor sessions, todos and manual lesson logging."),
  component: Tutor,
});

function Tutor() {
  const todos = useTodos();
  const sessions = useTutorSessions();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [minutes, setMinutes] = useState("30");
  const [tutor, setTutor] = useState("");
  const [topics, setTopics] = useState("");
  const [homework, setHomework] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 md:px-10">
        <h1 className="fr text-4xl">Tutor & course</h1>

        <section className="panel p-6">
          <h2 className="font-medium">To-do</h2>
          <DataView
            query={todos}
            isEmpty={(d) => d.filter((x) => !x.done).length === 0}
            empty={<EmptyState title="All done" />}
          >
            {(list) => (
              <ul className="mt-3 space-y-2 text-sm">
                {list.map((todo) => (
                  <li key={todo.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={todo.done}
                      className="accent-primary"
                      onChange={() => void api.todos.done(todo.id).then(() => todos.refetch())}
                    />
                    <span className={todo.done ? "text-muted-foreground line-through" : ""}>
                      {todo.text}
                    </span>
                    {todo.due && <Chip>by {todo.due}</Chip>}
                  </li>
                ))}
              </ul>
            )}
          </DataView>
        </section>

        <form
          className="panel space-y-3 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void api.tutor
              .addSession({
                day,
                minutes: Number(minutes) || 30,
                tutor: tutor || undefined,
                topics: topics || undefined,
                homework: homework || undefined,
                cost: cost ? Number(cost) : undefined,
              })
              .then(() => {
                setTopics("");
                setHomework("");
                sessions.refetch();
              })
              .finally(() => setBusy(false));
          }}
        >
          <h2 className="font-medium">Log a tutor session</h2>
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              inputMode="numeric"
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Minutes"
            />
            <input
              value={tutor}
              onChange={(e) => setTutor(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Tutor (e.g. Marie · italki)"
            />
            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              inputMode="decimal"
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Cost $"
            />
          </div>
          <input
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="Topics covered"
          />
          <input
            value={homework}
            onChange={(e) => setHomework(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="Homework assigned"
          />
          <button className={btn.primary} disabled={busy}>
            Add session
          </button>
          <p className="text-xs text-muted-foreground">
            Sessions also log manual speaking minutes to the hours ledger.
          </p>
        </form>

        <section className="panel p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Sessions</h2>
            <button className={btn.ghost} disabled title="Coming in R2">
              <Download className="h-4 w-4" /> Export weekly report
            </button>
          </div>
          <DataView
            query={sessions}
            isEmpty={(d) => d.length === 0}
            empty={<EmptyState title="No sessions yet" />}
          >
            {(list) => (
              <ul className="mt-3 divide-y divide-border text-sm">
                {list.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                    <span className="tabular-nums text-muted-foreground">{s.day}</span>
                    <span className="font-medium">{s.minutes} min</span>
                    {s.tutor && <span>{s.tutor}</span>}
                    {s.topics && <span className="text-muted-foreground">{s.topics}</span>}
                    {s.cost != null && <span className="ml-auto tabular-nums">${s.cost}</span>}
                  </li>
                ))}
              </ul>
            )}
          </DataView>
        </section>
      </div>
    </AppShell>
  );
}
