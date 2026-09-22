export const importanceLevels = ['important', 'useful', 'other'] as const;
export type Importance = (typeof importanceLevels)[number];
export type CategoryLevel = Importance | 'auto';

export type Category = {
  id: string;
  name: string;
  description: string;
  level: CategoryLevel;
};

export function effectiveImportance(
  categoryLevel: CategoryLevel | undefined,
  messageImportance: Importance | null
): Importance | null {
  if (!categoryLevel) return null;
  return categoryLevel === 'auto' ? messageImportance : categoryLevel;
}
