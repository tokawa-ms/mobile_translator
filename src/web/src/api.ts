import { getApiToken } from "./auth";
import { config } from "./config";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getApiToken();
  const resp = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

export interface SpeechToken { token: string; region: string; }
export interface SessionInfo {
  id: string;
  title: string;
  sourceLang: string;
  speakerName?: string | null;
  sessionNumber?: number | null;
  createdAt: string;
}
export interface Segment { id: string; seq: number; sourceText: string; ja: string; type: "segment"; }
export interface Summary {
  id: string;
  kind: "recent" | "long";
  text: string;
  createdAt: string;
  type: "summary";
  fromSeq?: number;
  toSeq?: number;
}
export interface Topic { id: string; title: string; rationale: string; summaryId: string; type: "topic"; }
export interface Question {
  id: string;
  text: string;
  topicId: string;
  type: "question";
  en?: string;
  ja?: string;
}

export const api = {
  speechToken: () => request<SpeechToken>("/api/speech/token", { method: "POST" }),
  listSessions: () => request<SessionInfo[]>("/api/sessions"),
  createSession: (title: string, sourceLang: string, speakerName?: string, sessionNumber?: number) =>
    request<SessionInfo>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title, sourceLang, speakerName, sessionNumber }),
    }),
  getSession: (id: string) => request<{ items: any[] }>(`/api/sessions/${id}`),
  addSegment: (id: string, sourceText: string, startMs = 0, endMs = 0) =>
    request<Segment>(`/api/sessions/${id}/segments`, {
      method: "POST",
      body: JSON.stringify({ sourceText, startMs, endMs }),
    }),
  summarizeRecent: (id: string) =>
    request<Summary>(`/api/sessions/${id}/summary/recent`, { method: "POST" }),
  summarizeLong: (id: string) =>
    request<Summary>(`/api/sessions/${id}/summary/long`, { method: "POST" }),
  generateTopics: (id: string, summaryId?: string) =>
    request<{ topics: Topic[] }>(`/api/sessions/${id}/topics`, {
      method: "POST",
      body: JSON.stringify({ summaryId: summaryId ?? null }),
    }),
  generateQuestion: (id: string, topicId: string) =>
    request<Question>(`/api/sessions/${id}/topics/${topicId}/question`, { method: "POST" }),
  downloadSessionUtterances: async (id: string) => {
    const token = await getApiToken();
    const resp = await fetch(`${config.apiBaseUrl}/api/sessions/${id}/segments/export`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);

    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const contentDisposition = resp.headers.get("Content-Disposition") || "";
    const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    const fileName = fileNameMatch?.[1] || `session-${id}-utterances.json`;

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  },
  downloadSessionItemsMarkdown: async (id: string) => {
    const token = await getApiToken();
    const resp = await fetch(`${config.apiBaseUrl}/api/sessions/${id}/items/export/markdown`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);

    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const contentDisposition = resp.headers.get("Content-Disposition") || "";
    const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    const fileName = fileNameMatch?.[1] || `session-${id}-all-items.md`;

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  },
};
