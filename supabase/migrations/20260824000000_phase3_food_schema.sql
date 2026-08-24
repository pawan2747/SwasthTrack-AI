-- SwasthTrack Migration Phase 3: Cleaned Master Food Database + Portions + Favorites
-- Run this in the Supabase SQL Editor to apply food module structures.

-- 1. TABLES & PORTIONS

-- Safely drop old/partial tables to ensure columns are created properly
DROP TABLE IF EXISTS patient_food_favorites CASCADE;
DROP TABLE IF EXISTS food_portions CASCADE;
DROP TABLE IF EXISTS food_items CASCADE;

CREATE TABLE IF NOT EXISTS food_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_hi TEXT,
    category TEXT NOT NULL,
    subcategory TEXT,
    reference_weight_g NUMERIC DEFAULT 100 CHECK (reference_weight_g > 0),
    reference_unit TEXT DEFAULT 'g',
    calories_per_100g NUMERIC CHECK (calories_per_100g >= 0),
    protein_g_100g NUMERIC DEFAULT 0 CHECK (protein_g_100g >= 0),
    carbs_g_100g NUMERIC DEFAULT 0 CHECK (carbs_g_100g >= 0),
    fat_g_100g NUMERIC DEFAULT 0 CHECK (fat_g_100g >= 0),
    fibre_g_100g NUMERIC DEFAULT 0 CHECK (fibre_g_100g >= 0),
    sodium_mg_100g NUMERIC DEFAULT 0 CHECK (sodium_mg_100g >= 0),
    source_type TEXT DEFAULT 'base_dataset',
    source_name TEXT,
    source_note TEXT,
    is_verified BOOLEAN DEFAULT TRUE,
    is_custom BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS food_portions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    food_item_id UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    portion_name TEXT NOT NULL,
    portion_name_hi TEXT,
    standardized_grams NUMERIC NOT NULL CHECK (standardized_grams > 0),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_food_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    food_item_id UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_patient_food_favorite UNIQUE (patient_id, food_item_id)
);

-- Alter food_logs to support advanced calorie calculation features
CREATE TABLE IF NOT EXISTS food_logs_new (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    food_item_id UUID REFERENCES food_items(id) ON DELETE SET NULL,
    meal_type TEXT NOT NULL,
    food_name TEXT NOT NULL,
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    standardized_grams NUMERIC CHECK (standardized_grams >= 0),
    calories NUMERIC NOT NULL CHECK (calories >= 0),
    protein_g NUMERIC NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
    carbs_g NUMERIC NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
    fat_g NUMERIC NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
    fibre_g NUMERIC NOT NULL DEFAULT 0 CHECK (fibre_g >= 0),
    sodium_mg NUMERIC CHECK (sodium_mg >= 0),
    oil_quantity TEXT DEFAULT 'None',
    oil_calories NUMERIC DEFAULT 0 CHECK (oil_calories >= 0),
    calorie_confidence TEXT DEFAULT 'Medium' CHECK (calorie_confidence IN ('High', 'Medium', 'Low')),
    source_type TEXT DEFAULT 'base_dataset',
    source_note TEXT,
    consumed_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safely transition logs if there are any
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'food_logs') THEN
        INSERT INTO food_logs_new (id, patient_id, food_item_id, meal_type, food_name, quantity, unit, calories, protein_g, carbs_g, fat_g, fibre_g, sodium_mg, consumed_at, notes, created_at)
        SELECT id, patient_id, food_item_id, meal_type, food_name, quantity, unit, calories, protein_g, carbs_g, fat_g, fibre_g, sodium_mg, consumed_at, notes, created_at
        FROM food_logs
        ON CONFLICT DO NOTHING;
        DROP TABLE food_logs CASCADE;
    END IF;
    ALTER TABLE food_logs_new RENAME TO food_logs;
END $$;

-- 2. INDEXES
CREATE INDEX IF NOT EXISTS idx_food_items_name ON food_items(name);
CREATE INDEX IF NOT EXISTS idx_food_items_name_hi ON food_items(name_hi);
CREATE INDEX IF NOT EXISTS idx_food_portions_item ON food_portions(food_item_id);
CREATE INDEX IF NOT EXISTS idx_patient_food_favorites_patient ON patient_food_favorites(patient_id);
CREATE INDEX IF NOT EXISTS idx_food_logs_patient_consumed ON food_logs(patient_id, consumed_at DESC);

-- 3. RLS
ALTER TABLE food_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_portions ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_food_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow access to food_items" ON food_items;
    CREATE POLICY "Allow access to food_items" ON food_items FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow access to food_portions" ON food_portions;
    CREATE POLICY "Allow access to food_portions" ON food_portions FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow access to patient_food_favorites" ON patient_food_favorites;
    CREATE POLICY "Allow access to patient_food_favorites" ON patient_food_favorites FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow access to food_logs" ON food_logs;
    CREATE POLICY "Allow access to food_logs" ON food_logs FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
END $$;
