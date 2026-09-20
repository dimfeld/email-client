import type { Category } from './types';

export const defaultCategories: Category[] = [
	{ id: 'action', name: 'Action needed', description: 'The owner must reply, decide, review, schedule, approve, or complete a task.', level: 'important' },
	{ id: 'personal', name: 'Personal', description: 'A personal message from a person or group, not mainly about work.', level: 'auto' },
	{ id: 'work', name: 'Work', description: 'Useful work information that does not request a direct action.', level: 'auto' },
	{ id: 'transaction', name: 'Transactions', description: 'A receipt, invoice, order, payment, booking, shipment, or account transaction.', level: 'auto' },
	{ id: 'newsletter', name: 'Newsletters', description: 'A recurring publication, digest, or editorial update that the owner chose to receive.', level: 'auto' },
	{ id: 'notification', name: 'Notifications', description: 'An automated service, security, social, product, or system notification.', level: 'auto' },
	{ id: 'marketing', name: 'Marketing', description: 'A promotion, sales pitch, product announcement, or commercial campaign.', level: 'auto' },
	{ id: 'other', name: 'Other', description: 'The message does not fit the other categories.', level: 'auto' },
];
