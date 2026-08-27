import csv
import math
from collections import defaultdict

# 1. Load full datasets
with open('train.csv', 'r', encoding='utf-8') as f:
    train_data = list(csv.DictReader(f))

with open('test.csv', 'r', encoding='utf-8') as f:
    test_data = list(csv.DictReader(f))

print(f"Loaded train: {len(train_data)} rows, test: {len(test_data)} rows")

# Prior target rate
y_train = [int(r['Target']) for r in train_data]
prior = sum(y_train) / len(y_train)
print(f"Overall target prior (rate of 1): {prior:.4f}")

# Target encoding with smoothing (m-estimate)
def get_target_encoding(data, col, m=15):
    counts = defaultdict(int)
    sums = defaultdict(int)
    for r in data:
        counts[r[col]] += 1
        sums[r[col]] += int(r['Target'])
    te = {}
    for k in counts:
        te[k] = (sums[k] + m * prior) / (counts[k] + m)
    return te

te_dist = get_target_encoding(train_data, 'Distributor', m=15)
te_prod = get_target_encoding(train_data, 'Product', m=15)
te_dest = get_target_encoding(train_data, 'Destination', m=15)

# Calculate medians/means for imputation
def get_mean(data, col):
    vals = [float(r[col]) for r in data if r[col] != '']
    return sum(vals) / len(vals) if vals else 0.0

mean_sales = get_mean(train_data, 'Sales')
mean_comm = get_mean(train_data, 'Commission')
mean_dur = get_mean(train_data, 'Duration')
mean_age = get_mean(train_data, 'Age')

def extract_features(r):
    s = float(r['Sales']) if r['Sales'] != '' else mean_sales
    c = float(r['Commission']) if r['Commission'] != '' else mean_comm
    d = float(r['Duration']) if r['Duration'] != '' else mean_dur
    a = float(r['Age']) if r['Age'] != '' else mean_age

    td = te_dist.get(r['Distributor'], prior)
    tp = te_prod.get(r['Product'], prior)
    tdest = te_dest.get(r['Destination'], prior)

    comm_sales_ratio = c / (abs(s) + 1.0)
    sales_per_day = s / (abs(d) + 1.0)
    net_sales = s - c

    # Indicator features
    is_female = 1.0 if r['Gender'] == '1.0' else 0.0
    is_male = 1.0 if r['Gender'] == '0.0' else 0.0
    gender_missing = 1.0 if r['Gender'] == '' else 0.0
    
    is_high_dur = 1.0 if d > 350 else 0.0
    is_dist_2 = 1.0 if r['Distributor'] == '2' else 0.0
    is_prod_4 = 1.0 if r['Product'] == '4' else 0.0
    is_prod_17 = 1.0 if r['Product'] == '17' else 0.0
    is_prod_9 = 1.0 if r['Product'] == '9' else 0.0
    is_prod_high_risk = 1.0 if (is_prod_4 or is_prod_17 or is_prod_9) else 0.0

    return [
        td, tp, tdest,
        s / 100.0, c / 50.0, d / 100.0, a / 50.0,
        comm_sales_ratio, sales_per_day, net_sales / 100.0,
        is_female, is_male, gender_missing,
        is_high_dur, is_dist_2, is_prod_4, is_prod_17, is_prod_9, is_prod_high_risk
    ]

X_train = [extract_features(r) for r in train_data]
X_test = [extract_features(r) for r in test_data]
test_ids = [r['ID'] for r in test_data]

n_features = len(X_train[0])

# Feature standardization
f_means = [sum(X_train[i][j] for i in range(len(X_train))) / len(X_train) for j in range(n_features)]
f_stds = [(sum((X_train[i][j] - f_means[j])**2 for i in range(len(X_train))) / len(X_train))**0.5 for j in range(n_features)]
for j in range(n_features):
    if f_stds[j] == 0: f_stds[j] = 1.0

def scale(X):
    return [[(X[i][j] - f_means[j]) / f_stds[j] for j in range(n_features)] for i in range(len(X))]

X_train_scaled = scale(X_train)
X_test_scaled = scale(X_test)

# Train regularized model
weights = [0.0] * n_features
bias = math.log(prior / (1 - prior))
lr = 0.06
epochs = 500
reg = 0.008
pos_weight = 4.0

for epoch in range(epochs):
    g_w = [0.0] * n_features
    g_b = 0.0
    for x, y in zip(X_train_scaled, y_train):
        z = sum(w * xi for w, xi in zip(weights, x)) + bias
        p = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
        weight = pos_weight if y == 1 else 1.0
        err = (p - y) * weight
        for j in range(n_features):
            g_w[j] += err * x[j]
        g_b += err
    N = len(X_train_scaled)
    for j in range(n_features):
        weights[j] -= lr * (g_w[j] / N + reg * weights[j])
    bias -= lr * (g_b / N)

# Test Predictions
test_probs = []
for x in X_test_scaled:
    z = sum(w * xi for w, xi in zip(weights, x)) + bias
    p = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
    test_probs.append(p)

# Using optimal threshold (0.65) found during validation
best_threshold = 0.65
test_predictions = [1 if p >= best_threshold else 0 for p in test_probs]

# Write submission.csv
with open('submission.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(['ID', 'Target'])
    for tid, pred in zip(test_ids, test_predictions):
        writer.writerow([tid, pred])

print(f"submission.csv successfully generated with {len(test_predictions)} rows!")
from collections import Counter
counts = Counter(test_predictions)
print(f"Predicted class distribution: {counts}")
