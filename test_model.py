import csv
import math
import random
from collections import defaultdict, Counter

with open('train.csv') as f:
    train_data = list(csv.DictReader(f))

random.seed(42)
random.shuffle(train_data)

n_val = int(len(train_data) * 0.2)
val_set = train_data[:n_val]
train_set = train_data[n_val:]

print(f"Train size: {len(train_set)}, Val size: {len(val_set)}")

def f1_weighted(y_true, y_pred):
    # compute weighted f1 score
    classes = [0, 1]
    weights = [y_true.count(c) / len(y_true) for c in classes]
    f1s = []
    for c in classes:
        tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == c and yp == c)
        fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt != c and yp == c)
        fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == c and yp != c)
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0
        f1s.append(f1)
    return sum(w * f for w, f in zip(weights, f1s)) * 100

y_val_true = [int(r['Target']) for r in val_set]

# Baseline: All 0s
y_all_zero = [0] * len(y_val_true)
print(f"All zeros weighted F1: {f1_weighted(y_val_true, y_all_zero):.4f}")


# Feature extraction with Target Encoding & Interactions
prior = sum(int(r['Target']) for r in train_set) / len(train_set)

# Smooth target encoding function
def get_target_encoding(data, col, m=10):
    counts = defaultdict(int)
    sums = defaultdict(int)
    for r in data:
        counts[r[col]] += 1
        sums[r[col]] += int(r['Target'])
    te = {}
    for k in counts:
        te[k] = (sums[k] + m * prior) / (counts[k] + m)
    return te

te_dist = get_target_encoding(train_set, 'Distributor', m=10)
te_prod = get_target_encoding(train_set, 'Product', m=10)
te_dest = get_target_encoding(train_set, 'Destination', m=10)

# Compute mean values for imputation
sales_vals = [float(r['Sales']) for r in train_set if r['Sales'] != '']
mean_sales = sum(sales_vals) / len(sales_vals)
comm_vals = [float(r['Commission']) for r in train_set if r['Commission'] != '']
mean_comm = sum(comm_vals) / len(comm_vals)
dur_vals = [float(r['Duration']) for r in train_set if r['Duration'] != '']
mean_dur = sum(dur_vals) / len(dur_vals)
age_vals = [float(r['Age']) for r in train_set if r['Age'] != '']
mean_age = sum(age_vals) / len(age_vals)

def featurize(r):
    s = float(r['Sales']) if r['Sales'] != '' else mean_sales
    c = float(r['Commission']) if r['Commission'] != '' else mean_comm
    d = float(r['Duration']) if r['Duration'] != '' else mean_dur
    a = float(r['Age']) if r['Age'] != '' else mean_age
    
    td = te_dist.get(r['Distributor'], prior)
    tp = te_prod.get(r['Product'], prior)
    tdest = te_dest.get(r['Destination'], prior)
    
    gender_is_female = 1.0 if r['Gender'] == '1.0' else 0.0
    gender_is_male = 1.0 if r['Gender'] == '0.0' else 0.0
    gender_missing = 1.0 if r['Gender'] == '' else 0.0
    
    comm_sales_ratio = c / (abs(s) + 1.0)
    sales_per_day = s / (abs(d) + 1.0)
    net_sales = s - c
    
    # Non-linear indicators
    is_high_dur = 1.0 if d > 350 else 0.0
    is_dist_2 = 1.0 if r['Distributor'] == '2' else 0.0
    is_prod_4 = 1.0 if r['Product'] == '4' else 0.0
    is_prod_17 = 1.0 if r['Product'] == '17' else 0.0
    is_prod_9 = 1.0 if r['Product'] == '9' else 0.0
    
    return [
        td, tp, tdest,
        s / 100.0, c / 50.0, d / 100.0, a / 50.0,
        comm_sales_ratio, sales_per_day, net_sales / 100.0,
        gender_is_female, gender_is_male, gender_missing,
        is_high_dur, is_dist_2, is_prod_4, is_prod_17, is_prod_9
    ]

X_tr = [featurize(r) for r in train_set]
y_tr = [int(r['Target']) for r in train_set]
X_val = [featurize(r) for r in val_set]

n_features = len(X_tr[0])

# Feature scaling
f_means = [sum(X_tr[i][j] for i in range(len(X_tr))) / len(X_tr) for j in range(n_features)]
f_stds = [(sum((X_tr[i][j] - f_means[j])**2 for i in range(len(X_tr))) / len(X_tr))**0.5 for j in range(n_features)]
for j in range(n_features):
    if f_stds[j] == 0: f_stds[j] = 1.0

def scale(X):
    return [[(X[i][j] - f_means[j]) / f_stds[j] for j in range(n_features)] for i in range(len(X))]

X_tr_s = scale(X_tr)
X_val_s = scale(X_val)

# Logistic Regression with focal/weighted loss
weights = [0.0] * n_features
bias = -2.0 # Log-odds prior
lr = 0.08
epochs = 400
reg = 0.005

pos_w = 4.0

for epoch in range(epochs):
    g_w = [0.0] * n_features
    g_b = 0.0
    for x, y in zip(X_tr_s, y_tr):
        z = sum(w * xi for w, xi in zip(weights, x)) + bias
        p = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
        weight = pos_w if y == 1 else 1.0
        err = (p - y) * weight
        for j in range(n_features):
            g_w[j] += err * x[j]
        g_b += err
    N = len(X_tr_s)
    for j in range(n_features):
        weights[j] -= lr * (g_w[j] / N + reg * weights[j])
    bias -= lr * (g_b / N)

# Validation predictions
val_probs = []
for x in X_val_s:
    z = sum(w * xi for w, xi in zip(weights, x)) + bias
    p = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
    val_probs.append(p)

best_th = 0.5
best_score = 0
for th_int in range(10, 90, 2):
    th = th_int / 100.0
    preds = [1 if p >= th else 0 for p in val_probs]
    score = f1_weighted(y_val_true, preds)
    if score > best_score:
        best_score = score
        best_th = th

print(f"Logistic Model Best Threshold: {best_th:.2f}, Weighted F1: {best_score:.4f}")

# Gradient Boosted Decision Stumps
print("Training Gradient Boosted Decision Stumps...")

class DecisionStump:
    def __init__(self):
        self.feature_idx = 0
        self.threshold = 0.0
        self.left_val = 0.0
        self.right_val = 0.0

    def fit(self, X, residuals, min_samples=20):
        best_loss = float('inf')
        n_samples = len(X)
        total_sum = sum(residuals)
        
        for f_idx in range(n_features):
            # Sort by feature
            vals = sorted(set(X[i][f_idx] for i in range(0, n_samples, 4))) # subsample thresholds
            for th in vals:
                left_sum = sum(residuals[i] for i in range(n_samples) if X[i][f_idx] <= th)
                left_count = sum(1 for i in range(n_samples) if X[i][f_idx] <= th)
                right_count = n_samples - left_count
                if left_count < min_samples or right_count < min_samples:
                    continue
                right_sum = total_sum - left_sum
                
                loss = - (left_sum**2 / left_count + right_sum**2 / right_count)
                if loss < best_loss:
                    best_loss = loss
                    self.feature_idx = f_idx
                    self.threshold = th
                    self.left_val = left_sum / (left_count + 10.0) # shrinkage
                    self.right_val = right_sum / (right_count + 10.0)

    def predict_one(self, x):
        return self.left_val if x[self.feature_idx] <= self.threshold else self.right_val

# Train 20 stumps
stumps = []
current_preds = [math.log(prior / (1 - prior))] * len(X_tr_s)
val_tree_preds = [math.log(prior / (1 - prior))] * len(X_val_s)
learning_rate = 0.15

for step in range(25):
    # compute negative gradient
    residuals = []
    for yp, yt in zip(current_preds, y_tr):
        p = 1.0 / (1.0 + math.exp(-max(-30, min(30, yp))))
        residuals.append(yt - p)
    stump = DecisionStump()
    stump.fit(X_tr_s, residuals)
    stumps.append(stump)
    
    for i in range(len(X_tr_s)):
        current_preds[i] += learning_rate * stump.predict_one(X_tr_s[i])
    for i in range(len(X_val_s)):
        val_tree_preds[i] += learning_rate * stump.predict_one(X_val_s[i])

# Evaluate GBDT
gbdt_probs = [1.0 / (1.0 + math.exp(-max(-30, min(30, p)))) for p in val_tree_preds]
best_th = 0.5
best_score = 0
for th_int in range(10, 90, 2):
    th = th_int / 100.0
    preds = [1 if p >= th else 0 for p in gbdt_probs]
    score = f1_weighted(y_val_true, preds)
    if score > best_score:
        best_score = score
        best_th = th

print(f"GBDT Model Best Threshold: {best_th:.2f}, Weighted F1: {best_score:.4f}")

# Ensemble blend: Logistic + GBDT
blend_probs = [0.5 * p1 + 0.5 * p2 for p1, p2 in zip(val_probs, gbdt_probs)]
best_th = 0.5
best_score = 0
for th_int in range(10, 90, 2):
    th = th_int / 100.0
    preds = [1 if p >= th else 0 for p in blend_probs]
    score = f1_weighted(y_val_true, preds)
    if score > best_score:
        best_score = score
        best_th = th

print(f"Ensemble Blend Best Threshold: {best_th:.2f}, Weighted F1: {best_score:.4f}")

