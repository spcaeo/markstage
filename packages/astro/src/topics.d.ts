// Types of @markstage/astro/topics (the code is plain ESM).

export interface TopicGroup {
  id: string;
  name: string;
  /** the group's lead page, "<collection>/<id>" */
  lead: string | null;
  members: string[];
}

/** One of the site's subjects (a topic file): its main page, groups and pages, as "<collection>/<id>". */
export interface Topic {
  id: string;
  title: string;
  description: string;
  pillar: string | null;
  money: string | null;
  anchors: string[];
  keywords: string[];
  members: string[];
  groups: TopicGroup[];
}

export interface TopicPlace {
  topic: string;
  group: string | null;
  role: 'pillar' | 'lead' | 'member';
}

/** A page to list under "More on this topic". */
export interface MorePage {
  collection: string;
  id: string;
  role: 'pillar' | 'lead' | 'member';
  group: string | null;
  topic: string;
}

export interface TopicsHelpers {
  topics(): Topic[];
  placeOf(collection: string, id: string): TopicPlace | null;
  moreOnTopic(collection: string, id: string, opts?: { limit?: number }): MorePage[];
}

/** Every topic file of a normalized site config. */
export function readTopics(cfg: unknown): Topic[];
/** The helpers for one normalized site config. */
export function topicsOf(cfg: unknown): TopicsHelpers;
/** The site's topics ([] when it keeps none). */
export function topics(): Promise<Topic[]>;
/** Where a page sits in the topics, or null. */
export function placeOf(collection: string, id: string): Promise<TopicPlace | null>;
/** The pages to list under "More on this topic": its group first, then the topic's main page, then the rest. */
export function moreOnTopic(collection: string, id: string, opts?: { limit?: number }): Promise<MorePage[]>;
