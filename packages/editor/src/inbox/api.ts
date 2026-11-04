// The Inbox's routes (docs/OPERATIONS.md "Messages and alerts, all in one place"): every message a site form sent,
// and every alert, in one list. Typed calls through the shell's request() (CSRF token, ApiError, the 401 hand-off).
import { request } from '../api';
import { config } from '../runtime';

export type InboxKind = 'message' | 'alert';
// 'held': kept back by the server while its form is past its hourly limit; it becomes new on its own
export type InboxStatus = 'new' | 'handled' | 'spam' | 'held';

export interface Person {
  id: string;
  name: string;
}

export interface InboxItem {
  id: string;
  kind: InboxKind;
  at: string;
  status: InboxStatus;
  /** a message: the form it came from, who sent it, the service asked about */
  form?: string;
  formLabel?: string;
  from?: { name?: string; email?: string } | null;
  service?: string | null;
  /** an alert: what kind, how bad, where it points in the editor (#/jobs/…) */
  alertKind?: string;
  level?: 'info' | 'warn' | 'error';
  link?: string | null;
  /** one line: the message's opening words, or the alert's text */
  summary: string;
  assignee?: Person | null;
  /** a message brought in from another site (the WordPress import) */
  imported?: { from: string; id?: string | number } | null;
  /** a message's mail to the team: waiting, sent, none to send, or failed (it is tried again) */
  alert?: 'pending' | 'sent' | 'none' | 'failed' | null;
  /** a message whose form sends to a CRM (Odoo): waiting, sent (with the lead's id there) or failed (why; tried again) */
  crm?: InboxCrm | null;
}

export interface InboxCrm {
  state: 'pending' | 'sent' | 'failed';
  /** the CRM's name, "Odoo" */
  name: string;
  leadId: string | null;
  error?: string | null;
}

export interface InboxList {
  items: InboxItem[];
  total: number;
  page: number;
  perPage: number;
  facets?: { forms?: { id: string; label: string; count: number }[]; services?: { value: string; count: number }[]; status?: Partial<Record<InboxStatus, number>>; alertFailed?: number; crmFailed?: number };
  /** the places' source, which its licence asks to show wherever they are (e.g. DB-IP, CC BY 4.0) */
  credits?: string | null;
}

export interface InboxNote {
  id: string;
  at: string;
  by: Person;
  text: string;
}

export interface InboxDetail extends InboxItem {
  /** what the visitor filled in, in the form's order (name, email, phone, message, service, how soon, budget, page) */
  fields: { key: string; label: string; value: string }[];
  /** where it came from: referrer, landing page, UTM source and medium, IP, approximate location, browser */
  meta?: Record<string, string | null | undefined>;
  notes: InboxNote[];
  history?: { at: string; by: Person | null; change: string }[];
  /** the team mail: how many tries, the last error, when it is tried next */
  alertTries?: number;
  alertError?: string | null;
  alertNextAt?: string | null;
  /** the CRM: how many tries, the last error, when it is tried next, when it went */
  crmTries?: number;
  crmError?: string | null;
  crmNextAt?: string | null;
  crmAt?: string | null;
  version: string;
}

/** The URL's filters, as the server reads them. */
export interface InboxQuery {
  q?: string;
  kind?: string;
  form?: string;
  service?: string;
  status?: string;
  assignee?: string;
  /** 'failed': the messages whose mail to the team was not sent */
  alert?: string;
  /** 'failed': the messages not sent to the CRM */
  crm?: string;
  from?: string;
  to?: string;
  page?: number;
}

const qs = (q: InboxQuery) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const enc = encodeURIComponent;

export const list = (q: InboxQuery) => request<InboxList>(`inbox${qs(q)}`);
export const item = (id: string) => request<InboxDetail>(`inbox/${enc(id)}`);
export const change = (id: string, body: { status?: InboxStatus; assigneeId?: string | null; version: string }) => request<InboxDetail>(`inbox/${enc(id)}`, json('PATCH', body));
/** "Send to Odoo again": one try now. Refused in the server's words: 409 (not for the CRM, or there already), 502 (not sent; `data.item` is the message now). */
export const sendAgain = (id: string) => request<InboxDetail>(`inbox/${enc(id)}/crm`, json('POST', {}));
export const addNote = (id: string, text: string) => request<InboxNote>(`inbox/${enc(id)}/notes`, json('POST', { text }));
/** The CSV of what the filters show (a plain link: the browser downloads it with the session cookie). */
export const csvUrl = (q: InboxQuery) => `${config().api.replace(/\/+$/, '')}/inbox.csv${qs({ ...q, page: undefined })}`;
