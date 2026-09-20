import type { Importance } from '$lib/categories';
export type { Category, CategoryLevel } from '$lib/categories';

export type EmailCategory = string;

export type IncomingEmail = {
	id: string;
	threadId?: string;
	from?: string;
	to?: string;
	subject?: string;
	date?: string;
	snippet?: string;
	bodyText?: string;
	bodyHtml?: string;
	bodyTruncated?: boolean;
	labels?: string[];
};

export type GmailWatchPayload = {
	source: 'gmail';
	account: string;
	historyId?: string;
	deletedMessageIds: string[];
	messages: IncomingEmail[];
};

export type Classification = {
	category: EmailCategory;
	importance: Importance | null;
	hasActionItem: boolean;
	actionItemProbability: number;
	hasReminder: boolean;
	reminderProbability: number;
	model: string;
	categoryConfidence: number;
	importanceConfidence: number | null;
	categoryProbabilities: Record<string, number>;
	importanceProbabilities: Record<string, number>;
};

export type ExtractedActionItem = {
	title: string;
	details: string | null;
	dueAt: string | null;
};

export type ExtractedReminder = {
	title: string;
	details: string | null;
	remindAt: string | null;
};

export type EmailExtraction = {
	actionItems: ExtractedActionItem[];
	reminders: ExtractedReminder[];
	model: string;
};

export type StoredEmail = {
	id: number;
	accountEmail: string;
	gmailId: string;
	threadId: string | null;
	fromAddress: string;
	toAddresses: string;
	subject: string;
	messageDate: string | null;
	snippet: string;
	bodyText: string;
	bodyHtml: string | null;
	bodyTruncated: boolean;
	labels: string[];
	category: EmailCategory | null;
	importance: Importance | null;
	hasActionItem: boolean | null;
	actionItemProbability: number | null;
	hasReminder: boolean | null;
	reminderProbability: number | null;
	actionItems: ExtractedActionItem[];
	reminders: ExtractedReminder[];
	extractionModel: string | null;
	extractionError: string | null;
	categoryConfidence: number | null;
	importanceConfidence: number | null;
	classificationError: string | null;
	deletedAt: string | null;
};

export type SyncedContact = {
	accountEmail: string;
	resourceName: string;
	displayName: string;
	emails: string[];
	phones: string[];
	organization: string | null;
};

export type SyncedCalendar = {
	accountEmail: string;
	calendarId: string;
	summary: string;
	timeZone: string | null;
	backgroundColor: string | null;
	selected: boolean;
};

export type SyncedCalendarEvent = {
	accountEmail: string;
	calendarId: string;
	eventId: string;
	summary: string;
	description: string | null;
	location: string | null;
	startAt: string;
	endAt: string;
	allDay: boolean;
	status: string;
	htmlLink: string | null;
	organizer: string | null;
	attendees: string[];
};
