export const importanceLevels = ['important', 'useful', 'other'] as const;
export type Importance = (typeof importanceLevels)[number];
export type CategoryLevel = Importance | 'auto';

export type Category = {
  id: string;
  name: string;
  description: string;
  level: CategoryLevel;
};
