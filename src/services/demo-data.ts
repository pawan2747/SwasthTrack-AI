import type {
  ActivityLog,
  BPLog,
  DailyScore,
  FoodLog,
  Medicine,
  MedicineLog,
  Patient,
  ReportSummary,
  WeightLog,
} from "@/types";

// Demo data is isolated here so future database/API reads can replace it without rewriting page UI.
export const patient: Patient = {
  id: "patient-demo-001",
  name: "Mr. Rajiv Sharma",
  age: 52,
  sex: "Male",
  conditions: ["Hypertension", "Fatty liver"],
  previousEvents: [{ label: "Stroke", year: 2023 }],
  calorieTargetKcal: 1600,
};

export const dailyScore: DailyScore = {
  id: "daily-score-today",
  date: "Today",
  score: 84,
  maxScore: 100,
  label: "Behavioral wellness score",
  note: "This score reflects tracked habits and routine completion. It is not a medical diagnosis score.",
};

export const foodLogs: FoodLog[] = [
  {
    id: "food-001",
    mealType: "Breakfast",
    foodName: "Vegetable poha",
    quantity: "1 medium bowl",
    estimatedCalories: 260,
    proteinGrams: 6,
    time: "08:10",
    source: "Manual",
  },
  {
    id: "food-002",
    mealType: "Lunch",
    foodName: "Dal, roti, cucumber salad",
    quantity: "1 plate",
    estimatedCalories: 430,
    proteinGrams: 18,
    time: "13:20",
    source: "Text",
  },
  {
    id: "food-003",
    mealType: "Evening snack",
    foodName: "Roasted chana",
    quantity: "30 g",
    estimatedCalories: 110,
    proteinGrams: 6,
    time: "17:05",
    source: "Photo",
  },
];

export const bpLogs: BPLog[] = [
  {
    id: "bp-001",
    systolic: 128,
    diastolic: 82,
    pulse: 74,
    period: "Morning",
    recordedAt: "Today, 07:15",
  },
  {
    id: "bp-002",
    systolic: 132,
    diastolic: 84,
    pulse: 76,
    period: "Evening",
    recordedAt: "Yesterday, 19:30",
  },
];

export const weightLogs: WeightLog[] = [
  { id: "weight-001", weightKg: 78.4, recordedAt: "Today, 07:05" },
  { id: "weight-002", weightKg: 78.7, recordedAt: "Yesterday, 07:00" },
  { id: "weight-003", weightKg: 79.1, recordedAt: "5 days ago" },
];

export const medicines: Medicine[] = [
  {
    id: "med-001",
    name: "Telmisartan",
    dose: "40 mg",
    scheduledTime: "08:00",
    period: "Morning",
  },
  {
    id: "med-002",
    name: "Aspirin",
    dose: "75 mg",
    scheduledTime: "14:00",
    period: "Afternoon",
  },
  {
    id: "med-003",
    name: "Atorvastatin",
    dose: "20 mg",
    scheduledTime: "21:30",
    period: "Night",
  },
];

export const medicineLogs: MedicineLog[] = [
  {
    id: "med-log-001",
    medicineId: "med-001",
    scheduledFor: "Today, 08:00",
    status: "Taken",
  },
  {
    id: "med-log-002",
    medicineId: "med-002",
    scheduledFor: "Today, 14:00",
    status: "Late",
  },
  {
    id: "med-log-003",
    medicineId: "med-003",
    scheduledFor: "Today, 21:30",
    status: "Missed",
  },
];

export const activityLog: ActivityLog = {
  id: "activity-today",
  date: "Today",
  steps: 0,
  distanceKm: 0,
  activityCalories: 0,
  sleepHours: undefined,
};

export const todayChecklist = [
  { id: "check-001", label: "Log breakfast and lunch", completed: false },
  { id: "check-002", label: "Record morning blood pressure", completed: false },
  { id: "check-003", label: "Confirm medicines taken", completed: false },
  { id: "check-004", label: "Walk after dinner", completed: false },
];

export const reportSummaries: ReportSummary[] = [
  {
    range: "7 Days",
    averageCalories: 1420,
    averageBp: "129/83",
    averageWeightKg: 78.6,
    averageSteps: 5200,
    medicineAdherencePercent: 88,
    averageHealthScore: 82,
  },
  {
    range: "30 Days",
    averageCalories: 1495,
    averageBp: "131/84",
    averageWeightKg: 79.2,
    averageSteps: 4700,
    medicineAdherencePercent: 84,
    averageHealthScore: 79,
  },
  {
    range: "3 Months",
    averageCalories: 1530,
    averageBp: "132/85",
    averageWeightKg: 80.1,
    averageSteps: 4300,
    medicineAdherencePercent: 81,
    averageHealthScore: 76,
  },
  {
    range: "1 Year",
    averageCalories: 1585,
    averageBp: "134/86",
    averageWeightKg: 81.4,
    averageSteps: 3900,
    medicineAdherencePercent: 78,
    averageHealthScore: 73,
  },
];
