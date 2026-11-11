import { useEffect, useState } from "react";
import { createWordNote, deleteWordNote, editWordNote, listWordNotes, type WordNote } from "../api/wordNotes";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Spinner } from "../components/ui";

export function WordNotes({ word, compact = false }: { word: string; compact?: boolean }) {
  const [notes, setNotes] = useState<WordNote[]>([]);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => listWordNotes(word).then(r => { setNotes(r.notes); setError(false); }).catch(() => setError(true));
  useEffect(() => { let active = true; listWordNotes(word).then(r => { if (active) setNotes(r.notes); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [word]);
  const save = async () => {
    setBusy(true);
    try { if (editing !== null) await editWordNote(editing, text.trim()); else await createWordNote(word, text.trim()); setText(""); setEditing(null); await load(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  const content = <div className="flex flex-col gap-3">
    {error && <div className="text-sm text-destructive">Couldn’t load or save notes. <Button variant="outline" onClick={() => void load()}>Retry</Button></div>}
    {notes.map(note => <div key={note.id} className="flex flex-col gap-1 border-b pb-2">
      <p className="whitespace-pre-wrap text-sm">{note.text}</p>
      <time className="text-xs text-muted-foreground" dateTime={note.updated_at}>{new Date(note.updated_at).toLocaleString()}</time>
      {!compact && <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => { setEditing(note.id); setText(note.text); }}>Edit</Button><Button variant="ghost" size="sm" onClick={async () => { try { await deleteWordNote(note.id); await load(); } catch { setError(true); } }}>Delete</Button></div>}
    </div>)}
    {!compact && <><Textarea aria-label="Note text" value={text} onChange={e => setText(e.target.value)} /><div className="flex gap-2"><Button disabled={busy || !text.trim()} onClick={() => void save()}>{editing !== null ? "Save note" : "Add note"}</Button>{editing !== null && <Button variant="ghost" onClick={() => { setEditing(null); setText(""); }}>Cancel</Button>}{busy && <Spinner label="Saving note…" />}</div></>}
  </div>;
  return compact ? <Collapsible onOpenChange={open => { if (open) void load(); }}><CollapsibleTrigger className="text-xs text-muted-foreground">Notes ({notes.length})</CollapsibleTrigger><CollapsibleContent>{content}</CollapsibleContent></Collapsible> : content;
}
