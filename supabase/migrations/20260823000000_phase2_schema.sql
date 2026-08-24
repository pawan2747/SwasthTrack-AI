-- SwasthTrack Phase 2: Patient Profile + Database Schema
-- Run this script in the Supabase SQL Editor to initialize all tables, indexes, RLS policies, and demo data.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLES

-- 2.1 Patients table
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    age INTEGER CHECK (age > 0 AND age <= 120),
    gender TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
    height_cm NUMERIC CHECK (height_cm > 0),
    current_weight_kg NUMERIC CHECK (current_weight_kg > 0),
    target_weight_kg NUMERIC CHECK (target_weight_kg > 0),
    daily_calorie_target INTEGER DEFAULT 1600 CHECK (daily_calorie_target > 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.2 Medical conditions table
CREATE TABLE IF NOT EXISTS medical_conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    condition_name TEXT NOT NULL,
    diagnosed_year INTEGER CHECK (diagnosed_year >= 1900 AND diagnosed_year <= 2100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.3 Medicines table
CREATE TABLE IF NOT EXISTS medicines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    medicine_name TEXT NOT NULL,
    dose TEXT NOT NULL,
    scheduled_time TIME NOT NULL,
    meal_relation TEXT, -- e.g. 'Before food', 'After food', 'With food', 'Empty stomach'
    frequency TEXT DEFAULT 'daily',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.4 Food items master table
CREATE TABLE IF NOT EXISTS food_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    serving_size NUMERIC CHECK (serving_size > 0),
    serving_unit TEXT NOT NULL,
    calories NUMERIC NOT NULL CHECK (calories >= 0),
    protein_g NUMERIC NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
    carbs_g NUMERIC NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
    fat_g NUMERIC NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
    fibre_g NUMERIC NOT NULL DEFAULT 0 CHECK (fibre_g >= 0),
    sodium_mg NUMERIC CHECK (sodium_mg >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.5 Food logs table
CREATE TABLE IF NOT EXISTS food_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    food_item_id UUID REFERENCES food_items(id) ON DELETE SET NULL,
    meal_type TEXT NOT NULL,
    food_name TEXT NOT NULL,
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    calories NUMERIC NOT NULL CHECK (calories >= 0),
    protein_g NUMERIC NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
    carbs_g NUMERIC NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
    fat_g NUMERIC NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
    fibre_g NUMERIC NOT NULL DEFAULT 0 CHECK (fibre_g >= 0),
    sodium_mg NUMERIC CHECK (sodium_mg >= 0),
    consumed_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.6 Blood pressure logs table
CREATE TABLE IF NOT EXISTS bp_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    systolic INTEGER NOT NULL CHECK (systolic > 40 AND systolic < 300),
    diastolic INTEGER NOT NULL CHECK (diastolic > 20 AND diastolic < 200),
    pulse INTEGER CHECK (pulse > 30 AND pulse < 250),
    reading_type TEXT,
    measured_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.7 Weight logs table
CREATE TABLE IF NOT EXISTS weight_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    weight_kg NUMERIC NOT NULL CHECK (weight_kg > 0 AND weight_kg < 500),
    measured_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.8 Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    steps INTEGER DEFAULT 0 CHECK (steps >= 0),
    distance_km NUMERIC DEFAULT 0 CHECK (distance_km >= 0),
    walking_minutes INTEGER DEFAULT 0 CHECK (walking_minutes >= 0),
    estimated_calories_burned NUMERIC DEFAULT 0 CHECK (estimated_calories_burned >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_patient_activity_date UNIQUE (patient_id, date)
);

-- 2.9 Sleep logs table
CREATE TABLE IF NOT EXISTS sleep_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    sleep_hours NUMERIC NOT NULL CHECK (sleep_hours >= 0 AND sleep_hours <= 24),
    bedtime TIME,
    wake_time TIME,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_patient_sleep_date UNIQUE (patient_id, date)
);

-- 2.10 Medicine logs table
CREATE TABLE IF NOT EXISTS medicine_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    scheduled_time TIMESTAMPTZ NOT NULL,
    taken_time TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('taken', 'late', 'missed', 'pending')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.11 Daily checklists table
CREATE TABLE IF NOT EXISTS daily_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    checklist_date DATE NOT NULL,
    item_key TEXT NOT NULL,
    item_label TEXT NOT NULL,
    scheduled_time TIME,
    status TEXT DEFAULT 'pending' CHECK (status IN ('completed', 'pending', 'late', 'missed')),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_patient_checklist_item_date UNIQUE (patient_id, checklist_date, item_key)
);

-- 3. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_medical_conditions_patient ON medical_conditions(patient_id);
CREATE INDEX IF NOT EXISTS idx_medicines_patient_active ON medicines(patient_id, active);
CREATE INDEX IF NOT EXISTS idx_food_logs_patient_consumed ON food_logs(patient_id, consumed_at DESC);
CREATE INDEX IF NOT EXISTS idx_bp_logs_patient_measured ON bp_logs(patient_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_weight_logs_patient_measured ON weight_logs(patient_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_patient_date ON activity_logs(patient_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sleep_logs_patient_date ON sleep_logs(patient_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_medicine_logs_patient_scheduled ON medicine_logs(patient_id, scheduled_time DESC);
CREATE INDEX IF NOT EXISTS idx_daily_checklists_patient_date ON daily_checklists(patient_id, checklist_date DESC);

-- 4. ROW LEVEL SECURITY (RLS)
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicine_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checklists ENABLE ROW LEVEL SECURITY;

-- 4.1 Access Policies (Allow authenticated & anon for complete CRUD operations)
DO $$
BEGIN
    -- Patients policies
    DROP POLICY IF EXISTS "Allow access to patients" ON patients;
    DROP POLICY IF EXISTS "Allow select patients" ON patients;
    DROP POLICY IF EXISTS "Allow insert patients" ON patients;
    DROP POLICY IF EXISTS "Allow update patients" ON patients;
    DROP POLICY IF EXISTS "Allow delete patients" ON patients;
    
    CREATE POLICY "Allow select patients" ON patients FOR SELECT TO authenticated, anon USING (true);
    CREATE POLICY "Allow insert patients" ON patients FOR INSERT TO authenticated, anon WITH CHECK (true);
    CREATE POLICY "Allow update patients" ON patients FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);
    CREATE POLICY "Allow delete patients" ON patients FOR DELETE TO authenticated, anon USING (true);

    -- Medical conditions
    DROP POLICY IF EXISTS "Allow access to medical_conditions" ON medical_conditions;
    CREATE POLICY "Allow access to medical_conditions" ON medical_conditions FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    -- Medicines
    DROP POLICY IF EXISTS "Allow access to medicines" ON medicines;
    CREATE POLICY "Allow access to medicines" ON medicines FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    -- Food items
    DROP POLICY IF EXISTS "Allow access to food_items" ON food_items;
    CREATE POLICY "Allow access to food_items" ON food_items FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    -- Food logs
    DROP POLICY IF EXISTS "Allow access to food_logs" ON food_logs;
    CREATE POLICY "Allow access to food_logs" ON food_logs FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    -- BP logs
    DROP POLICY IF EXISTS "Allow access to bp_logs" ON bp_logs;
    CREATE POLICY "Allow access to bp_logs" ON bp_logs FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    -- Weight logs
    DROP POLICY IF EXISTS "Allow access to weight_logs" ON weight_logs;
    CREATE POLICY "Allow access to weight_logs" ON weight_logs FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    -- Activity logs
    DROP POLICY IF EXISTS "Allow access to activity_logs" ON activity_logs;
    CREATE POLICY "Allow access to activity_logs" ON activity_logs FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    -- Sleep logs
    DROP POLICY IF EXISTS "Allow access to sleep_logs" ON sleep_logs;
    CREATE POLICY "Allow access to sleep_logs" ON sleep_logs FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    -- Medicine logs
    DROP POLICY IF EXISTS "Allow access to medicine_logs" ON medicine_logs;
    CREATE POLICY "Allow access to medicine_logs" ON medicine_logs FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    -- Daily checklists
    DROP POLICY IF EXISTS "Allow access to daily_checklists" ON daily_checklists;
    CREATE POLICY "Allow access to daily_checklists" ON daily_checklists FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
END $$;

-- 5. DEMO SEED DATA (Only inserted once if patient does not exist)
DO $$
DECLARE
    demo_patient_id UUID := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    med1_id UUID := 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a21';
    med2_id UUID := 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    med3_id UUID := 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23';
BEGIN
    -- Insert Patient ONLY if table is empty or patient doesn't exist
    IF NOT EXISTS (SELECT 1 FROM patients WHERE id = demo_patient_id) THEN
        INSERT INTO patients (id, name, age, gender, height_cm, current_weight_kg, target_weight_kg, daily_calorie_target)
        VALUES (demo_patient_id, 'Mr. Rajiv Sharma', 52, 'Male', 172.0, 78.4, 72.0, 1600);
    END IF;

    -- Insert Medical Conditions
    INSERT INTO medical_conditions (patient_id, condition_name, diagnosed_year, notes)
    VALUES 
        (demo_patient_id, 'Hypertension', 2018, 'Primary essential hypertension managed with medication'),
        (demo_patient_id, 'Fatty Liver', 2020, 'Grade 1 non-alcoholic fatty liver disease'),
        (demo_patient_id, 'Previous Stroke (2023)', 2023, 'Mild ischemic stroke, full motor recovery, ongoing secondary prevention')
    ON CONFLICT DO NOTHING;

    -- Insert Medicines
    INSERT INTO medicines (id, patient_id, medicine_name, dose, scheduled_time, meal_relation, frequency, active)
    VALUES
        (med1_id, demo_patient_id, 'Telmisartan', '40 mg', '08:00:00', 'After food', 'daily', true),
        (med2_id, demo_patient_id, 'Aspirin', '75 mg', '14:00:00', 'After food', 'daily', true),
        (med3_id, demo_patient_id, 'Atorvastatin', '20 mg', '21:30:00', 'After food', 'daily', true)
    ON CONFLICT DO NOTHING;

    -- Insert Sample Food Items
    INSERT INTO food_items (name, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g, fibre_g, sodium_mg)
    VALUES
        ('Vegetable Poha', 1, 'medium bowl', 260, 6, 42, 7, 4, 280),
        ('Dal Tadka with 2 Phulka Roti and Cucumber Salad', 1, 'plate', 430, 18, 62, 11, 8, 340),
        ('Roasted Chana', 30, 'g', 110, 6, 17, 2, 4, 50),
        ('Moong Dal Khichdi', 1, 'bowl', 310, 12, 50, 6, 6, 290)
    ON CONFLICT DO NOTHING;
END $$;
