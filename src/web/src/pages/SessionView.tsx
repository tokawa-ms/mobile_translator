import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AudioConfig,
  SpeechConfig,
  SpeechRecognizer,
  ResultReason,
} from "microsoft-cognitiveservices-speech-sdk";
import { api, type Segment, type Summary, type Topic, type Question } from "../api";

interface Item { type: string; [k: string]: any; }

export function SessionView() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<Item[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [questionsByTopicId, setQuestionsByTopicId] = useState<Record<string, Question>>({});
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const sessionLang = useRef<string>("en-US");
  const summarizingRef = useRef(false);
  const lastRecentSummarySeqRef = useRef(0);

  async function refresh() {
    if (!id) return;
    const data = await api.getSession(id);
    setItems(data.items);
    const sess = data.items.find(i => i.type === "session");
    if (sess) sessionLang.current = sess.sourceLang;
    const recentSummaries = data.items.filter(i => i.type === "summary" && i.kind === "recent") as Summary[];
    const latestRecent = recentSummaries.at(-1) as (Summary & { toSeq?: number }) | undefined;
    lastRecentSummarySeqRef.current = latestRecent?.toSeq ?? 0;
  }
  useEffect(() => { refresh().catch(console.error); }, [id]);

  const segments = useMemo(
    () =>
      (items.filter(i => i.type === "segment") as (Segment & Item)[])
        .slice()
        .sort((a, b) => b.seq - a.seq),
    [items]
  );
  const summaries = items.filter(i => i.type === "summary") as (Summary & Item)[];
  const topics = useMemo(
    () =>
      (items.filter(i => i.type === "topic") as (Topic & Item)[])
        .slice()
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()),
    [items]
  );

  async function maybeSummarizeRecent(latestSeq: number) {
    if (!id || summarizingRef.current) return;
    if (latestSeq - lastRecentSummarySeqRef.current < 3) return;
    summarizingRef.current = true;
    try {
      const summary = await api.summarizeRecent(id);
      lastRecentSummarySeqRef.current = (summary as Summary & { toSeq?: number }).toSeq ?? latestSeq;
      setItems(prev => [...prev, summary]);
    } catch (err) {
      console.error("recent summary failed", err);
    } finally {
      summarizingRef.current = false;
    }
  }

  async function startRecording() {
    if (!id || recording) return;
    const token = await api.speechToken();
    const speechConfig = SpeechConfig.fromAuthorizationToken(token.token, token.region);
    speechConfig.speechRecognitionLanguage = sessionLang.current;
    const audioConfig = AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new SpeechRecognizer(speechConfig, audioConfig);

    recognizer.recognized = async (_s, e) => {
      if (e.result.reason === ResultReason.RecognizedSpeech && e.result.text.trim()) {
        try {
          const seg = await api.addSegment(id, e.result.text);
          setItems(prev => [...prev, seg]);
          await maybeSummarizeRecent(seg.seq);
        } catch (err) { console.error(err); }
      }
    };
    recognizer.canceled = (_s, e) => { console.warn("canceled", e); };
    recognizer.startContinuousRecognitionAsync();
    recognizerRef.current = recognizer;
    setRecording(true);
  }

  function stopRecording() {
    const r = recognizerRef.current;
    if (!r) return;
    r.stopContinuousRecognitionAsync(() => { r.close(); recognizerRef.current = null; setRecording(false); });
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); } catch (e) { console.error(e); alert(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="page">
      <div className="row">
        {!recording
          ? <button onClick={startRecording}>● 録音開始</button>
          : <button onClick={stopRecording}>■ 停止</button>}
        <button disabled={!!busy} onClick={() => run("recent", async () => { await api.summarizeRecent(id!); await refresh(); })}>
          直近要約 (mini)
        </button>
        <button disabled={!!busy} onClick={() => run("long", async () => { await api.summarizeLong(id!); await refresh(); })}>
          長期要約 (full)
        </button>
        <button disabled={!!busy} onClick={() => run("topics", async () => { await api.generateTopics(id!); await refresh(); })}>
          Q&amp;A トピック生成
        </button>
      </div>

      <section>
        <h3>発話 / 訳（新しい順）</h3>
        <ul className="segments">
          {segments.map(s => (
            <li key={s.id}>
              <div className="src">[{s.seq}] {s.sourceText}</div>
              <div className="ja">{s.ja}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>要約</h3>
        {summaries.map(s => (
          <article key={s.id} className={`summary ${s.kind}`}>
            <header>{s.kind === "recent" ? "直近" : "長期"} ・ {new Date(s.createdAt).toLocaleTimeString()}</header>
            <pre>{s.text}</pre>
          </article>
        ))}
      </section>

      <section>
        <h3>Q&amp;A 候補</h3>
        <ul className="topics">
          {topics.map(t => (
            <li key={t.id}>
              <div className="topic-header">
                <div className="title">{t.title}</div>
                <button onClick={() => run("q", async () => {
                  const q = await api.generateQuestion(id!, t.id);
                  setQuestionsByTopicId(prev => ({ ...prev, [t.id]: q }));
                })}>Q&amp;A生成</button>
              </div>
              <div className="rationale">{t.rationale}</div>
              {questionsByTopicId[t.id] && (
                <div className="question">
                  {questionsByTopicId[t.id].en || questionsByTopicId[t.id].ja ? (
                    <>
                      {questionsByTopicId[t.id].en && <div><strong>EN:</strong> {questionsByTopicId[t.id].en}</div>}
                      {questionsByTopicId[t.id].ja && <div><strong>JA:</strong> {questionsByTopicId[t.id].ja}</div>}
                    </>
                  ) : (
                    <div><strong>質問:</strong> {questionsByTopicId[t.id].text}</div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
