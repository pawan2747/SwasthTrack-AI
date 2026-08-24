export type Sex = "Male" | "Female" | "Other";

export type MealType =
  | "Breakfast"
  | "Mid-morning"
  | "Lunch"
  | "Evening snack"
  | "Dinner"
  | "Bedtime";

export type FoodSource = "Manual" | "Text" | "Photo" | "Voice";

export type ReadingPeriod = "Morning" | "Evening";

export type MedicinePeriod = "Morning" | "Afternoon" | "Evening" | "Night";

export type MedicineStatus = "Taken" | "Late" | "Missed";

export type ReportRange = "7 Days" | "30 Days" | "3 Months" | "1 Year";

export interface Patient {
  id: string;
  name: string;
  age: number;
  sex: Sex;
  conditions: string[];
  previousEvents: Array<{
    label: string;
    year: number;
  }>;
  calorieTargetKcal: number;
}

export interface FoodLog {
  id: string;
  mealType: MealType;
  foodName: string;
  quantity: string;
  estimatedCalories: number;
  proteinGrams: number;
  time: string;
  source: FoodSource;
}

export interface BPLog {
  id: string;
  systolic: number;
  diastolic: number;
  pulse: number;
  period: ReadingPeriod;
  recordedAt: string;
}

export interface WeightLog {
  id: string;
  weightKg: number;
  recordedAt: string;
}

export interface Medicine {
  id: string;
  name: string;
  dose: string;
  scheduledTime: string;
  period: MedicinePeriod;
}

export interface MedicineLog {
  id: string;
  medicineId: string;
  scheduledFor: string;
  status: MedicineStatus;
}

export interface ActivityLog {
  id: string;
  date: string;
  steps: number;
  distanceKm: number;
  activityCalories: number;
  sleepHours?: number;
}

export interface DailyScore {
  id: string;
  date: string;
  score: number;
  maxScore: number;
  label: string;
  note: string;
}

export interface ReportSummary {
  range: ReportRange;
  averageCalories: number;
  averageBp: string;
  averageWeightKg: number;
  averageSteps: number;
  medicineAdherencePercent: number;
  averageHealthScore: number;
}
