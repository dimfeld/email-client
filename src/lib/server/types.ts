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
	body?: string;
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
	model: string;
	categoryConfidence: number;
	importanceConfidence: number | null;
	categoryProbabilities: Record<string, number>;
	importanceProbabilities: Record<string, number>;
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
	body: string;
	bodyTruncated: boolean;
	labels: string[];
	category: EmailCategory | null;
	importance: Importance | null;
	categoryConfidence: number | null;
	importanceConfidence: number | null;
	classificationError: string | null;
	deletedAt: string | null;
};
