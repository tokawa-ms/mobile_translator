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
export interface SessionInfo { id: string; title: string; sourceLang: string; createdAt: string; }
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
  createSession: (title: string, sourceLang: string) =>
    request<SessionInfo>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title, sourceLang }),
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
};
