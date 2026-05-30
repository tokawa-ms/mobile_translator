import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Body1,
  Button,
  Card,
  Caption1,
  Divider,
  Subtitle2,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AudioConfig,
  SpeechConfig,
  SpeechRecognizer,
  ResultReason,
} from "microsoft-cognitiveservices-speech-sdk";
import { api, type Segment, type Summary, type Topic, type Question } from "../api";

interface Item { type: string; [k: string]: any; }

const useStyles = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  layout: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    "@media screen and (min-width: 1024px)": {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacingHorizontalXL,
    },
  },
  leftPane: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    "@media screen and (min-width: 1024px)": {
      flex: "0 0 44%",
      position: "sticky",
      top: tokens.spacingVerticalL,
    },
  },
  rightPane: {
    minWidth: 0,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  mobileTop: {
    display: "none",
    "@media screen and (max-width: 1023px)": {
      display: "flex",
      flexDirection: "column",
      gap: tokens.spacingVerticalM,
    },
  },
  desktopOnly: {
    "@media screen and (max-width: 1023px)": {
      display: "none",
    },
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
    "@media screen and (max-width: 1023px)": {
      position: "sticky",
      top: "62px",
      zIndex: 10,
      backgroundColor: tokens.colorNeutralBackground3,
      paddingTop: tokens.spacingVerticalS,
      paddingBottom: tokens.spacingVerticalS,
    },
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  segmentCard: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  sourceText: {
    color: tokens.colorNeutralForeground3,
  },
  translatedText: {
    fontWeight: tokens.fontWeightSemibold,
  },
  summaryCard: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  summaryText: {
    margin: 0,
    whiteSpace: "pre-wrap",
    fontFamily: "inherit",
  },
  hideOnMobile: {
    "@media screen and (max-width: 1023px)": {
      display: "none",
    },
  },
  topicCard: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  topicHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  topicTitle: {
    fontWeight: tokens.fontWeightSemibold,
  },
  rationale: {
    color: tokens.colorNeutralForeground3,
  },
  questionCard: {
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
});

export function SessionView() {
  const styles = useStyles();
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<Item[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [questionsByTopicId, setQuestionsByTopicId] = useState<Record<string, Question>>({});
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const wakeLockRef = useRef<any>(null);
  const sessionLang = useRef<string>("en-US");
  const summarizingRef = useRef(false);
  const lastRecentSummarySeqRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    async function requestWakeLock() {
      if (disposed) return;
      if (!("wakeLock" in navigator)) return;
      if (document.visibilityState !== "visible") return;
      if (wakeLockRef.current && !wakeLockRef.current.released) return;

      try {
        const wakeLock = await (navigator as any).wakeLock.request("screen");
        wakeLockRef.current = wakeLock;
        wakeLock.addEventListener?.("release", () => {
          if (wakeLockRef.current === wakeLock) {
            wakeLockRef.current = null;
          }
        });
      } catch (err) {
        console.warn("Wake Lock request failed", err);
      }
    }

    function handleVisible() {
      requestWakeLock().catch(() => {});
    }

    requestWakeLock().catch(() => {});
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

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
  const summaries = useMemo(
    () =>
      (items.filter(i => i.type === "summary") as (Summary & Item)[])
        .slice()
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()),
    [items]
  );
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

  const latestSummary = summaries[0];

  const actionButtons = (
    <>
      {!recording
        ? <Button appearance="primary" onClick={startRecording}>● 録音開始</Button>
        : <Button appearance="outline" onClick={stopRecording}>■ 停止</Button>}
      <Button disabled={!!busy} onClick={() => run("recent", async () => { await api.summarizeRecent(id!); await refresh(); })}>
        直近要約 (mini)
      </Button>
      <Button disabled={!!busy} onClick={() => run("long", async () => { await api.summarizeLong(id!); await refresh(); })}>
        長期要約 (full)
      </Button>
      <Button disabled={!!busy} onClick={() => run("topics", async () => { await api.generateTopics(id!); await refresh(); })}>
        Q&amp;A トピック生成
      </Button>
      <Button disabled={!!busy} onClick={() => run("export", async () => { await api.downloadSessionUtterances(id!); })}>
        発話JSONダウンロード
      </Button>
      <Button disabled={!!busy} onClick={() => run("export-md", async () => { await api.downloadSessionItemsMarkdown(id!); })}>
        全文書MDダウンロード
      </Button>
    </>
  );

  return (
    <div className={styles.page}>
      <section className={styles.mobileTop}>
        <div className={styles.actions}>{actionButtons}</div>
        {latestSummary && (
          <section className={styles.section}>
            <Subtitle2>最新の要約</Subtitle2>
            <Card className={styles.summaryCard}>
              <Text weight="semibold">{latestSummary.kind === "recent" ? "直近" : "長期"} ・ {new Date(latestSummary.createdAt).toLocaleTimeString()}</Text>
              <pre className={styles.summaryText}>{latestSummary.text}</pre>
            </Card>
          </section>
        )}
      </section>

      <div className={styles.layout}>
        <section className={styles.leftPane}>
          <Subtitle2>発話 / 訳（新しい順）</Subtitle2>
          <div className={styles.list}>
            {segments.map(s => (
              <Card key={s.id} className={styles.segmentCard}>
                <Caption1 className={styles.sourceText}>[{s.seq}] {s.sourceText}</Caption1>
                <Body1 className={styles.translatedText}>{s.ja}</Body1>
              </Card>
            ))}
          </div>
        </section>

        <div className={styles.rightPane}>
          <div className={`${styles.actions} ${styles.desktopOnly}`}>
            {actionButtons}
          </div>
          <Divider className={styles.desktopOnly} />

          <section className={styles.section}>
            <Subtitle2>要約（新しい順）</Subtitle2>
            {summaries.map((s, index) => (
              <Card key={s.id} className={`${styles.summaryCard} ${index === 0 ? styles.hideOnMobile : ""}`}>
                <Text weight="semibold">{s.kind === "recent" ? "直近" : "長期"} ・ {new Date(s.createdAt).toLocaleTimeString()}</Text>
                <pre className={styles.summaryText}>{s.text}</pre>
              </Card>
            ))}
          </section>

          <section className={styles.section}>
            <Subtitle2>Q&amp;A 候補</Subtitle2>
            <div className={styles.list}>
              {topics.map(t => (
                <Card key={t.id} className={styles.topicCard}>
                  <div className={styles.topicHeader}>
                    <Text className={styles.topicTitle}>{t.title}</Text>
                    <Button size="small" onClick={() => run("q", async () => {
                      const q = await api.generateQuestion(id!, t.id);
                      setQuestionsByTopicId(prev => ({ ...prev, [t.id]: q }));
                    })}>Q&amp;A生成</Button>
                  </div>
                  <Text size={200} className={styles.rationale}>{t.rationale}</Text>
                  {questionsByTopicId[t.id] && (
                    <Card className={styles.questionCard}>
                      {questionsByTopicId[t.id].en || questionsByTopicId[t.id].ja ? (
                        <>
                          {questionsByTopicId[t.id].en && <Text><strong>EN:</strong> {questionsByTopicId[t.id].en}</Text>}
                          {questionsByTopicId[t.id].ja && <Text><strong>JA:</strong> {questionsByTopicId[t.id].ja}</Text>}
                        </>
                      ) : (
                        <Text><strong>質問:</strong> {questionsByTopicId[t.id].text}</Text>
                      )}
                    </Card>
                  )}
                </Card>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
