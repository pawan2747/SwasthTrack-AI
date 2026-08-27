import csv
import math

# Full dataset extracted directly from the user's provided problem details
train_raw_str = """ID,Distributor,Product,Duration,Destination,Sales,Commission,Gender,Age,Target
fffe31003600330038003500,6,16,8,60,69.3,41.58,,51,0
fffe33003600300031003400,2,4,368,112,161.0,40.25,0.0,51,0
fffe320033003300,2,4,387,112,291.75,72.94,0.0,51,0
fffe390039003800,7,10,4,25,18.0,0.0,,36,0
fffe3500350031003000,11,20,40,59,39.5,25.68,0.0,38,0
fffe31003000300037003300,7,10,15,55,20.0,0.0,,37,0
fffe33003300360037003200,7,10,38,132,18.0,0.0,,38,0
fffe32003500310030003200,2,9,26,112,18.0,4.5,0.0,23,0
fffe32003100320031003600,7,1,30,67,46.0,0.0,,36,0
fffe3900380030003200,9,8,111,67,40.0,14.0,0.0,36,0"""

test_raw_str = """ID,Distributor,Product,Duration,Destination,Sales,Commission,Gender,Age
fffe3800370038003900,2,4,367,112,252.85,63.21,1.0,25
fffe34003200370037003500,7,10,24,21,10.0,0.0,,36
fffe32003100320030003200,6,16,14,122,29.7,17.82,,22
fffe34003400310037003000,7,1,2,122,26.0,0.0,,36
fffe32003400390038003000,9,8,13,56,22.0,7.7,0.0,26"""

# Helper to read CSV string
def parse_csv_str(csv_str):
    lines = csv_str.strip().split('\n')
    reader = csv.DictReader(lines)
    return list(reader)

train_data = parse_csv_str(train_raw_str)
test_data = parse_csv_str(test_raw_str)

num_cols = ['Duration', 'Sales', 'Commission', 'Age']
cat_cols = ['Distributor', 'Product', 'Destination', 'Gender']

# Preprocessing & Imputation
num_means = {}
for col in num_cols:
    vals = [float(r[col]) for r in train_data if r[col] != '' and r[col] is not None]
    num_means[col] = sum(vals) / len(vals) if vals else 0.0

def extract_features(row):
    feats = []
    for col in num_cols:
        val = row[col]
        feats.append(float(val) if val != '' and val is not None else num_means[col])
    
    dur, sales, comm, age = feats[0], feats[1], feats[2], feats[3]
    feats.append(comm / (abs(sales) + 1e-5))
    feats.append(sales / (abs(dur) + 1e-5))
    feats.append(sales - comm)
    
    for col in cat_cols:
        val = row[col]
        feats.append(hash(f"{col}_{val}") % 100 / 100.0)
        
    return feats

X_train = [extract_features(r) for r in train_data]
y_train = [int(r['Target']) for r in train_data]
X_test = [extract_features(r) for r in test_data]
test_ids = [r['ID'] for r in test_data]

n_feats = len(X_train[0])
means = [sum(X_train[i][j] for i in range(len(X_train))) / len(X_train) for j in range(n_feats)]
stds = [(sum((X_train[i][j] - means[j])**2 for i in range(len(X_train))) / len(X_train))**0.5 for j in range(n_feats)]
for j in range(n_feats):
    if stds[j] == 0: stds[j] = 1.0

def scale(X):
    return [[(X[i][j] - means[j]) / stds[j] for j in range(n_feats)] for i in range(len(X))]

X_train_scaled = scale(X_train)
X_test_scaled = scale(X_test)

pos_count = sum(y_train)
neg_count = len(y_train) - pos_count
pos_weight = neg_count / (pos_count + 1e-5) if pos_count > 0 else 1.0

weights = [0.0] * n_feats
bias = 0.0
lr = 0.05
epochs = 300
lambda_reg = 0.01

for epoch in range(epochs):
    d_weights = [0.0] * n_feats
    d_bias = 0.0
    
    for i in range(len(X_train_scaled)):
        x_i = X_train_scaled[i]
        y_i = y_train[i]
        
        z = sum(weights[j] * x_i[j] for j in range(n_feats)) + bias
        p = 1.0 / (1.0 + math.exp(-max(-50, min(50, z))))
        
        weight_multiplier = pos_weight if y_i == 1 else 1.0
        err = (p - y_i) * weight_multiplier
        
        for j in range(n_feats):
            d_weights[j] += err * x_i[j]
        d_bias += err
        
    N = len(X_train_scaled)
    for j in range(n_feats):
        weights[j] -= lr * (d_weights[j] / N + lambda_reg * weights[j])
    bias -= lr * (d_bias / N)

test_preds = []
for i in range(len(X_test_scaled)):
    x_i = X_test_scaled[i]
    z = sum(weights[j] * x_i[j] for j in range(n_feats)) + bias
    p = 1.0 / (1.0 + math.exp(-max(-50, min(50, z))))
    test_preds.append(1 if p >= 0.5 else 0)

with open('submission.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(['ID', 'Target'])
    for id_val, pred in zip(test_ids, test_preds):
        writer.writerow([id_val, pred])

print("submission.csv created successfully!")
with open('submission.csv', 'r') as f:
    print(f.read())
