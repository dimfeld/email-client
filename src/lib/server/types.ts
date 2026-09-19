export const emailCategories = [
	'action',
	'personal',
	'work',
	'transaction',
	'newsletter',
	'notification',
	'marketing',
	'other'
] as const;

export type EmailCategory = (typeof emailCategories)[number];

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
	useful: boolean;
	model: string;
	categoryConfidence: number;
	usefulnessConfidence: number;
	categoryProbabilities: Record<string, number>;
	usefulnessProbabilities: Record<string, number>;
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
	useful: boolean | null;
	categoryConfidence: number | null;
	usefulnessConfidence: number | null;
	classificationError: string | null;
	deletedAt: string | null;
};
