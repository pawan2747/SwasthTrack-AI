import pandas as pd
import numpy as np
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import f1_score
from sklearn.ensemble import GradientBoostingClassifier
import warnings
warnings.filterwarnings('ignore')

train = pd.read_csv('train.csv')
test = pd.read_csv('test.csv')

test_ids = test['ID']
y = train['Target'].astype(int)

train['is_train'] = 1
test['is_train'] = 0
test['Target'] = np.nan

df = pd.concat([train, test], ignore_index=True)

df['Gender'] = df['Gender'].fillna(-1.0)
df['Gender_missing'] = (df['Gender'] == -1.0).astype(int)

for col in ['Sales', 'Commission', 'Duration', 'Age']:
    df[col] = pd.to_numeric(df[col], errors='coerce')
    med = df.loc[df['is_train'] == 1, col].median()
    df[col] = df[col].fillna(med)

df['comm_sales_ratio'] = df['Commission'] / (df['Sales'].abs() + 1.0)
df['sales_per_day'] = df['Sales'] / (df['Duration'].abs() + 1.0)
df['comm_per_day'] = df['Commission'] / (df['Duration'].abs() + 1.0)
df['net_sales'] = df['Sales'] - df['Commission']

df['long_duration'] = (df['Duration'] > 350).astype(int)
df['dist_2'] = (df['Distributor'] == 2).astype(int)
df['risk_prod'] = df['Product'].isin([4, 9, 17]).astype(int)

prior = y.mean()
cat_cols = ['Distributor', 'Product', 'Destination']

for col in cat_cols:
    stats = train.groupby(col)['Target'].agg(['count', 'mean'])
    te = (stats['count'] * stats['mean'] + 10.0 * prior) / (stats['count'] + 10.0)
    df[f'{col}_te'] = df[col].map(te.to_dict()).fillna(prior)
    df[f'{col}_freq'] = df[col].map(df[col].value_counts(normalize=True).to_dict())

train_df = df[df['is_train'] == 1].drop(columns=['is_train', 'ID', 'Target'])
test_df = df[df['is_train'] == 0].drop(columns=['is_train', 'ID', 'Target'])

features = list(train_df.columns)
X = train_df[features]
X_test = test_df[features]

skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
oof = np.zeros(len(X))
preds = np.zeros(len(X_test))

scale = (len(y) - sum(y)) / sum(y)

for fold, (trn_idx, val_idx) in enumerate(skf.split(X, y)):
    X_tr, y_tr = X.iloc[trn_idx], y.iloc[trn_idx]
    X_val, y_val = X.iloc[val_idx], y.iloc[val_idx]

    weights = np.where(y_tr == 1, scale * 0.4, 1.0)

    clf = GradientBoostingClassifier(
        n_estimators=150,
        learning_rate=0.05,
        max_depth=4,
        subsample=0.8,
        random_state=42 + fold
    )
    clf.fit(X_tr, y_tr, sample_weight=weights)

    oof[val_idx] = clf.predict_proba(X_val)[:, 1]
    preds += clf.predict_proba(X_test)[:, 1] / 5

best_t = 0.5
best_score = 0

for t in np.linspace(0.1, 0.9, 81):
    sc = 100 * f1_score(y, (oof >= t).astype(int), average='weighted')
    if sc > best_score:
        best_score = sc
        best_t = t

test_preds = (preds >= best_t).astype(int)

sub = pd.DataFrame({
    'ID': test_ids,
    'Target': test_preds
})

sub.to_csv('submission.csv', index=False)
print("Done. Saved to submission.csv")
