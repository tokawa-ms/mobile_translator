import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type SessionInfo } from "../api";

const LANGS = [
  { code: "en-US", label: "英語 (米国)" },
  { code: "en-GB", label: "英語 (英国)" },
  { code: "zh-CN", label: "中国語 (簡体)" },
  { code: "ko-KR", label: "韓国語" },
  { code: "fr-FR", label: "フランス語" },
  { code: "de-DE", label: "ドイツ語" },
  { code: "es-ES", label: "スペイン語" },
];

export function SessionList() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState("en-US");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const data = await api.listSessions();
    setSessions(data);
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function create() {
    setLoading(true);
    try {
      await api.createSession(title || "Untitled", lang);
      setTitle("");
      await refresh();
    } finally { setLoading(false); }
  }

  return (
    <div className="page">
      <h2>新しいセッション</h2>
      <div className="row">
        <input placeholder="タイトル" value={title} onChange={e => setTitle(e.target.value)} />
        <select value={lang} onChange={e => setLang(e.target.value)}>
          {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button onClick={create} disabled={loading}>作成</button>
      </div>
      <h2>セッション一覧</h2>
      <ul className="sessions">
        {sessions.map(s => (
          <li key={s.id}>
            <Link to={`/sessions/${s.id}`}>{s.title}</Link>
            <small>{s.sourceLang} ・ {new Date(s.createdAt).toLocaleString()}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
