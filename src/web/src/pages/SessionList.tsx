import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  Dropdown,
  Field,
  Input,
  Option,
  Subtitle2,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { api, type SessionInfo } from "../api";

const LANGS = [
  { code: "en-US", label: "英語 (米国)" },
  { code: "en-GB", label: "英語 (英国)" },
  { code: "ja-JP", label: "日本語" },
  { code: "zh-CN", label: "中国語 (簡体)" },
  { code: "ko-KR", label: "韓国語" },
  { code: "fr-FR", label: "フランス語" },
  { code: "de-DE", label: "ドイツ語" },
  { code: "es-ES", label: "スペイン語" },
];

const useStyles = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  card: {
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(240px, 1fr))",
    gap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalM,
    "@media screen and (max-width: 720px)": {
      gridTemplateColumns: "1fr",
    },
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
  },
  sessions: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  sessionItem: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  sessionLink: {
    textDecorationLine: "none",
    color: tokens.colorBrandForegroundLink,
    fontWeight: tokens.fontWeightSemibold,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
  },
});

export function SessionList() {
  const styles = useStyles();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState("en-US");
  const [speakerName, setSpeakerName] = useState("");
  const [sessionNumber, setSessionNumber] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const data = await api.listSessions();
    setSessions(data);
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function create() {
    setLoading(true);
    try {
      const trimmedSpeakerName = speakerName.trim();
      const parsedSessionNumber = Number.parseInt(sessionNumber, 10);
      await api.createSession(
        title || "Untitled",
        lang,
        trimmedSpeakerName || undefined,
        Number.isNaN(parsedSessionNumber) ? undefined : parsedSessionNumber,
      );
      setTitle("");
      setSpeakerName("");
      setSessionNumber("");
      await refresh();
    } finally { setLoading(false); }
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <Subtitle2>新しいセッション</Subtitle2>
        <div className={styles.formGrid}>
          <Field label="タイトル">
            <Input placeholder="タイトル" value={title} onChange={e => setTitle(e.target.value)} />
          </Field>
          <Field label="収録言語">
            <Dropdown
              selectedOptions={[lang]}
              value={LANGS.find(l => l.code === lang)?.label ?? ""}
              onOptionSelect={(_e, data) => {
                if (data.optionValue) {
                  setLang(data.optionValue);
                }
              }}
            >
              {LANGS.map(l => <Option key={l.code} value={l.code}>{l.label}</Option>)}
            </Dropdown>
          </Field>
          <Field label="スピーカー名 (任意)">
            <Input placeholder="例: 山田 太郎" value={speakerName} onChange={e => setSpeakerName(e.target.value)} />
          </Field>
          <Field label="セッション通し番号 (任意)">
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="例: 12"
              value={sessionNumber}
              onChange={e => setSessionNumber(e.target.value)}
            />
          </Field>
        </div>
        <div className={styles.actions}>
          <Button appearance="primary" onClick={create} disabled={loading}>作成</Button>
        </div>
      </Card>

      <Card className={styles.card}>
        <Subtitle2>セッション一覧</Subtitle2>
        <div className={styles.sessions}>
          {sessions.map(s => (
            <Card key={s.id} className={styles.sessionItem}>
              <Link className={styles.sessionLink} to={`/sessions/${s.id}`}>{s.title}</Link>
              <Text size={200} className={styles.meta}>
                {s.sourceLang}
                {s.speakerName ? ` ・ ${s.speakerName}` : ""}
                {s.sessionNumber != null ? ` ・ #${s.sessionNumber}` : ""}
                {` ・ ${new Date(s.createdAt).toLocaleString()}`}
              </Text>
            </Card>
          ))}
        </div>
      </Card>
    </div>
  );
}
