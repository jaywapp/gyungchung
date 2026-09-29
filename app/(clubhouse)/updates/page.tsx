import { updateNotes, updateSourceLabels } from "@/lib/update-notes";
import { sectionMetadata } from "../section-meta";

export const metadata = sectionMetadata("updates");

export default function UpdatesPage() {
  const notes = [...updateNotes].sort((a, b) => b.date.localeCompare(a.date));

  return <section className="content updates-page">
    <div className="page-intro"><span className="eyebrow">WHAT&apos;S NEW</span><h1>업데이트 노트</h1><p>경충FC에 새로 생긴 기능과 달라진 점을 최근 날짜부터 확인하세요.</p></div>
    <div className="updates-heading"><h2>변경 기록</h2><span>최신순 · {notes.length}건</span></div>
    <ol className="updates-list">{notes.map((note, index) => <li key={note.id} className="updates-entry">
      <div className="updates-date"><time dateTime={note.date}>{note.date.replaceAll("-", ". ") + "."}</time>{index === 0 && <span>최신 업데이트</span>}</div>
      <article>
        <span className={"updates-source " + note.source}>{updateSourceLabels[note.source]}</span>
        <h3>{note.title}</h3>
        <p className="updates-summary">{note.summary}</p>
        <ul className="updates-changes">{note.changes.map((change) => <li key={change.text}><span className={"updates-kind " + change.kind}>{change.kind === "added" ? "추가" : "개선"}</span><span>{change.text}</span></li>)}</ul>
        {note.pullRequests.length > 0 && <div className="updates-sources">{note.pullRequests.map((number) => <a key={number} href={"https://github.com/jaywapp/gyungchung/pull/" + number} target="_blank" rel="noreferrer">변경 기록 #{number} ↗</a>)}</div>}
      </article>
    </li>)}</ol>
  </section>;
}
