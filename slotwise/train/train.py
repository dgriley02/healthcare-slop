"""Fit the Slotwise no-show model on the Kaggle "Medical Appointment No Shows" dataset.

Usage:  python train/train.py path/to/KaggleV2-May-2016.csv
Writes model.js (window.MODEL = {...}) next to index.html; the app picks it up automatically.
Features match app.js: lead-time bin, age bin, prior no-shows bin, weekday, SMS reminder.
"""
import json, sys, pathlib
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

df = pd.read_csv(sys.argv[1] if len(sys.argv) > 1 else "KaggleV2-May-2016.csv")
df["sched"] = pd.to_datetime(df.ScheduledDay).dt.tz_localize(None).dt.normalize()
df["appt"] = pd.to_datetime(df.AppointmentDay).dt.tz_localize(None).dt.normalize()
df["lead"] = (df.appt - df.sched).dt.days
df = df[(df.lead >= 0) & (df.Age >= 0)].copy()
df["y"] = (df["No-show"] == "Yes").astype(int)

# prior no-shows per patient (only appointments strictly before this one)
df = df.sort_values(["PatientId", "appt", "sched"])
df["prev"] = df.groupby("PatientId").y.cumsum() - df.y

lead_bin = pd.cut(df.lead, [-1, 0, 2, 7, 14, 30, 10**6], labels=["0", "1-2", "3-7", "8-14", "15-30", "31+"])
age_bin = pd.cut(df.Age, [-1, 17, 35, 55, 200], labels=["0-17", "18-35", "36-55", "56+"])
prev_bin = pd.cut(df.prev, [-1, 0, 1, 10**6], labels=["0", "1", "2+"])
wd = (df.appt.dt.weekday + 1).astype(str)  # JS getDay(): Mon=1 .. Sat=6

X = pd.concat([pd.get_dummies(lead_bin, prefix="lead"), pd.get_dummies(age_bin, prefix="age"),
               pd.get_dummies(prev_bin, prefix="prev"), pd.get_dummies(wd, prefix="wd"),
               df.SMS_received.rename("sms")], axis=1).astype(float)
y = df.y.values

tr, te = next(GroupShuffleSplit(test_size=0.2, random_state=0).split(X, y, groups=df.PatientId))
clf = LogisticRegression(max_iter=2000, C=1.0).fit(X.iloc[tr], y[tr])
auc = roc_auc_score(y[te], clf.predict_proba(X.iloc[te])[:, 1])
print(f"n={len(df)}  base rate={y.mean():.3f}  hold-out AUC={auc:.3f}")

w = dict(zip(X.columns, clf.coef_[0]))
group = lambda p: {k[len(p) + 1:]: round(v, 3) for k, v in w.items() if k.startswith(p + "_")}
model = {
    "source": "trained", "n": int(len(df)), "auc": round(auc, 4),
    "intercept": round(float(clf.intercept_[0]), 3),
    "lead": group("lead"), "age": group("age"), "prev": group("prev"), "weekday": group("wd"),
    # Note: SMS_received is confounded in this dataset (only sent for long lead times), so its fitted
    # sign is unreliable. Keep the literature-based reminder effect until a pilot measures it.
    "sms_fitted": round(w["sms"], 3),
}
out = pathlib.Path(__file__).resolve().parent.parent / "model.js"
out.write_text("window.MODEL = " + json.dumps(model, indent=2) + ";\n")
print("wrote", out)
