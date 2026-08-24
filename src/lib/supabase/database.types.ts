export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      patients: {
        Row: {
          id: string;
          name: string;
          age: number | null;
          gender: string | null;
          height_cm: number | null;
          current_weight_kg: number | null;
          target_weight_kg: number | null;
          daily_calorie_target: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          age?: number | null;
          gender?: string | null;
          height_cm?: number | null;
          current_weight_kg?: number | null;
          target_weight_kg?: number | null;
          daily_calorie_target?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          age?: number | null;
          gender?: string | null;
          height_cm?: number | null;
          current_weight_kg?: number | null;
          target_weight_kg?: number | null;
          daily_calorie_target?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      medical_conditions: {
        Row: {
          id: string;
          patient_id: string;
          condition_name: string;
          diagnosed_year: number | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          condition_name: string;
          diagnosed_year?: number | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          condition_name?: string;
          diagnosed_year?: number | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "medical_conditions_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      medicines: {
        Row: {
          id: string;
          patient_id: string;
          medicine_name: string;
          dose: string;
          scheduled_time: string;
          meal_relation: string | null;
          frequency: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          medicine_name: string;
          dose: string;
          scheduled_time: string;
          meal_relation?: string | null;
          frequency?: string;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          medicine_name?: string;
          dose?: string;
          scheduled_time?: string;
          meal_relation?: string | null;
          frequency?: string;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "medicines_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      food_items: {
        Row: {
          id: string;
          name: string;
          serving_size: number;
          serving_unit: string;
          calories: number;
          protein_g: number;
          carbs_g: number;
          fat_g: number;
          fibre_g: number;
          sodium_mg: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          serving_size: number;
          serving_unit: string;
          calories: number;
          protein_g?: number;
          carbs_g?: number;
          fat_g?: number;
          fibre_g?: number;
          sodium_mg?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          serving_size?: number;
          serving_unit?: string;
          calories?: number;
          protein_g?: number;
          carbs_g?: number;
          fat_g?: number;
          fibre_g?: number;
          sodium_mg?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      food_logs: {
        Row: {
          id: string;
          patient_id: string;
          food_item_id: string | null;
          meal_type: string;
          food_name: string;
          quantity: number;
          unit: string;
          calories: number;
          protein_g: number;
          carbs_g: number;
          fat_g: number;
          fibre_g: number;
          sodium_mg: number | null;
          consumed_at: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          food_item_id?: string | null;
          meal_type: string;
          food_name: string;
          quantity: number;
          unit: string;
          calories: number;
          protein_g?: number;
          carbs_g?: number;
          fat_g?: number;
          fibre_g?: number;
          sodium_mg?: number | null;
          consumed_at?: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          food_item_id?: string | null;
          meal_type?: string;
          food_name?: string;
          quantity?: number;
          unit?: string;
          calories?: number;
          protein_g?: number;
          carbs_g?: number;
          fat_g?: number;
          fibre_g?: number;
          sodium_mg?: number | null;
          consumed_at?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "food_logs_food_item_id_fkey";
            columns: ["food_item_id"];
            isOneToOne: false;
            referencedRelation: "food_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "food_logs_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      bp_logs: {
        Row: {
          id: string;
          patient_id: string;
          systolic: number;
          diastolic: number;
          pulse: number | null;
          reading_type: string | null;
          measured_at: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          systolic: number;
          diastolic: number;
          pulse?: number | null;
          reading_type?: string | null;
          measured_at?: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          systolic?: number;
          diastolic?: number;
          pulse?: number | null;
          reading_type?: string | null;
          measured_at?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bp_logs_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      weight_logs: {
        Row: {
          id: string;
          patient_id: string;
          weight_kg: number;
          measured_at: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          weight_kg: number;
          measured_at?: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          weight_kg?: number;
          measured_at?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "weight_logs_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_logs: {
        Row: {
          id: string;
          patient_id: string;
          date: string;
          steps: number;
          distance_km: number;
          walking_minutes: number;
          estimated_calories_burned: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          date: string;
          steps?: number;
          distance_km?: number;
          walking_minutes?: number;
          estimated_calories_burned?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          date?: string;
          steps?: number;
          distance_km?: number;
          walking_minutes?: number;
          estimated_calories_burned?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_logs_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      sleep_logs: {
        Row: {
          id: string;
          patient_id: string;
          date: string;
          sleep_hours: number;
          bedtime: string | null;
          wake_time: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          date: string;
          sleep_hours: number;
          bedtime?: string | null;
          wake_time?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          date?: string;
          sleep_hours?: number;
          bedtime?: string | null;
          wake_time?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sleep_logs_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      medicine_logs: {
        Row: {
          id: string;
          medicine_id: string;
          patient_id: string;
          scheduled_time: string;
          taken_time: string | null;
          status: "taken" | "late" | "missed" | "pending";
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          medicine_id: string;
          patient_id: string;
          scheduled_time: string;
          taken_time?: string | null;
          status: "taken" | "late" | "missed" | "pending";
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          medicine_id?: string;
          patient_id?: string;
          scheduled_time?: string;
          taken_time?: string | null;
          status?: "taken" | "late" | "missed" | "pending";
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "medicine_logs_medicine_id_fkey";
            columns: ["medicine_id"];
            isOneToOne: false;
            referencedRelation: "medicines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medicine_logs_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_checklists: {
        Row: {
          id: string;
          patient_id: string;
          checklist_date: string;
          item_key: string;
          item_label: string;
          scheduled_time: string | null;
          status: "completed" | "pending" | "late" | "missed";
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          checklist_date: string;
          item_key: string;
          item_label: string;
          scheduled_time?: string | null;
          status?: "completed" | "pending" | "late" | "missed";
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          checklist_date?: string;
          item_key?: string;
          item_label?: string;
          scheduled_time?: string | null;
          status?: "completed" | "pending" | "late" | "missed";
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_checklists_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
