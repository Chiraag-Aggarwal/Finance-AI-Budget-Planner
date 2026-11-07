"""Build synthetic examples and small browser models. Run with Python 3.10+.

No real accounts, .env files, survey values, or external APIs are read.
Generated metrics measure our simulator/phrases only, not real-world accuracy.
"""
from collections import Counter, defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
import random
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "synthetic"
OUTPUT = ROOT / "app" / "js" / "starter_models.mjs"

# Different base phrases stay in different splits, including all their variants.
# These examples were written for this app. They are NOT bank/customer records.
PHRASES = {
    "Food and groceries": [
        "weekly groceries rice vegetables", "milk bread eggs grocery shop",
        "fruit and vegetables market", "atta dal rice staples", "supermarket groceries",
        "ration kirana grocery", "doodh sabzi rashan", "दूध सब्जी राशन",
        "फल और किराना", "चावल दाल आटा",
        "vegetables for dinner groceries", "kirana rice milk",
        "fresh fruit grocery basket", "दूध और किराना सामान",
    ],
    "Housing and rent": [
        "monthly house rent", "apartment rent payment", "landlord rent transfer",
        "flat maintenance housing", "hostel room rent", "ghar ka kiraya",
        "room deposit rent", "घर का किराया", "मकान किराया", "housing society maintenance",
        "landlord monthly rent", "flat rent dues", "hostel rental payment", "मकान का किराया भुगतान",
    ],
    "Utilities": [
        "electricity bill", "water bill", "internet broadband bill", "mobile recharge phone",
        "cooking gas cylinder", "bijli ka bill", "wifi broadband recharge",
        "बिजली बिल", "पानी का बिल", "मोबाइल रिचार्ज",
        "paid electricity dues", "monthly broadband internet", "water charges bill", "बिजली का भुगतान",
    ],
    "Transport": [
        "petrol fuel bike", "diesel car fuel", "metro card recharge", "bus fare commute",
        "taxi ride office", "train ticket travel", "auto rickshaw fare", "cab ride",
        "पेट्रोल बाइक", "बस टिकट", "metro fare commute", "petrol pump payment",
        "taxi fare home", "बस का किराया",
    ],
    "Health": [
        "doctor consultation", "pharmacy medicine", "hospital treatment bill",
        "dentist appointment", "medical blood test", "dawai medical shop",
        "दवाई दुकान", "डॉक्टर फीस", "अस्पताल इलाज", "health checkup clinic",
        "doctor visit clinic", "medicine pharmacy purchase", "medical test lab", "दवाई का बिल",
    ],
    "Education": [
        "school tuition fees", "college semester fees", "textbooks school books",
        "online learning course", "coaching classes fees", "exam registration education",
        "school uniform books", "स्कूल फीस", "पढ़ाई किताबें", "कॉलेज फीस",
        "college tuition payment", "school books purchase", "coaching tuition class", "स्कूल की फीस",
    ],
    "Loan EMI": [
        "car loan emi", "home loan installment", "bike finance emi", "personal loan repayment",
        "education loan installment", "bank loan emi payment", "ऋण किस्त",
        "लोन ईएमआई", "loan monthly instalment", "कर्ज की किस्त",
        "vehicle loan installment", "home loan repayment", "bank emi debit", "लोन की किस्त",
    ],
    "Family support": [
        "money sent to parents", "parents monthly support", "family support transfer",
        "mother living expenses support", "father allowance", "support for relatives",
        "ghar paise bheje parents", "माता पिता को पैसे", "परिवार सहायता", "माँ को पैसे",
        "monthly parents allowance", "family financial support", "sent allowance to father", "परिवार को पैसे",
    ],
    "Personal": [
        "cinema movie tickets", "restaurant dinner outing", "clothes shopping",
        "salon haircut", "gym membership", "streaming subscription", "coffee cafe",
        "कपड़े खरीदारी", "सिनेमा टिकट", "रेस्टोरेंट खाना",
        "movie evening cinema", "salon hair appointment", "restaurant meal", "कपड़ों की खरीदारी",
    ],
    "Other": [
        "courier parcel", "postage stamps", "charity donation", "pet food supplies",
        "computer repair", "phone repair", "laptop accessories", "कूरियर पार्सल",
        "दान संस्था", "मोबाइल मरम्मत",
        "courier delivery parcel", "donation to charity", "repair laptop", "फोन की मरम्मत",
    ],
    "Salary": [
        "monthly salary credited", "employer payroll", "office salary income",
        "company wages", "salary arrears", "payroll bonus", "naukri salary",
        "वेतन मिला", "सैलरी जमा", "वेतन बोनस",
        "salary from employer", "monthly wages received", "payroll income", "सैलरी का भुगतान",
    ],
    "Business income": [
        "client invoice paid", "shop sales income", "freelance project payment",
        "business customer receipt", "consulting fees received", "sales revenue",
        "dukan ki kamai", "दुकान की कमाई", "ग्राहक भुगतान", "व्यापार आय",
        "client project invoice", "shop revenue sales", "freelance client payment", "दुकान बिक्री आय",
    ],
    "Other income": [
        "bank interest credited", "dividend received", "gift money received",
        "expense refund received", "cashback credited", "scholarship received",
        "pension payment income", "ब्याज मिला", "उपहार मिला", "पेंशन जमा",
        "bank interest income", "gift cash received", "refund credited", "पेंशन भुगतान",
    ],
}
INCOME = {"Salary", "Business income", "Other income"}
STOP = set("paid payment monthly weekly daily this for from and the a an to of ka ki ke mein se on at my our via upi online cash received credited purchase bill amount rs inr".split())

def terms(note):
    # Keep Hindi combining marks attached to their letters.
    text = unicodedata.normalize("NFKC", note).lower()
    clean = "".join(c if c.isalnum() or unicodedata.category(c).startswith("M") else " " for c in text)
    return [word for word in clean.split() if len(word) > 1 and word not in STOP and not word.isdigit()]

def category_data():
    """Keep all variants of a phrase together so train/test wording cannot overlap by variant."""
    rows = []
    for category, phrases in PHRASES.items():
        for index, phrase in enumerate(phrases):
            split = "train" if index < 10 else "validation" if index < 12 else "test"
            for variant, note in enumerate([phrase, "UPI " + phrase, phrase + " payment"]):
                rows.append(dict(source="synthetic", group=f"{category}-{index}",
                    split=split, type="income" if category in INCOME else "expense",
                    category=category, note=note, variant=variant))
    return rows

def fit_categories(rows, smoothing=0.5):
    """Learn smoothed word log-probabilities from the training split only."""
    counts = defaultdict(Counter)
    for row in rows:
        if row["split"] == "train":
            counts[row["category"]].update(terms(row["note"]))
    vocabulary = sorted(set().union(*[set(c) for c in counts.values()]))
    models = {}
    for category, values in sorted(counts.items()):
        denominator = sum(values.values()) + smoothing*len(vocabulary)
        models[category] = {
            "type": "income" if category in INCOME else "expense",
            "weights": {word: round(math.log((values[word] + smoothing) / denominator), 8) for word in vocabulary},
        }
    return dict(vocabulary=vocabulary, stopWords=sorted(STOP), categories=models,
                minScore=0.72, minMargin=0.25, smoothing=smoothing)

def classify(model, note, kind, threshold=None):
    known = set(model["vocabulary"])
    words = [w for w in terms(note) if w in known]
    if not words:
        return None
    scores = [(c, sum(m["weights"][w] for w in words)) for c,m in model["categories"].items() if m["type"] == kind]
    scores.sort(key=lambda item: item[1], reverse=True)
    weights = [math.exp(value-scores[0][1]) for _,value in scores]
    total = sum(weights)
    top, second = weights[0]/total, weights[1]/total
    if top < (threshold or model["minScore"]) or top-second < model["minMargin"]:
        return None
    return scores[0][0]

def category_metrics(model, rows, split, threshold=None):
    cases = [row for row in rows if row["split"] == split]
    predictions = [(r, classify(model,r["note"],r["type"],threshold)) for r in cases]
    accepted = sum(pred is not None for _,pred in predictions)
    correct = sum(pred == r["category"] for r,pred in predictions)
    return dict(rows=len(cases), suggestions=accepted, correct=correct,
                coverage=round(accepted/len(cases),4),
                accepted_accuracy=round(correct/accepted,4) if accepted else None)

def forecast_features(progress, count):
    n = math.log1p(min(count, 60))
    return [1.0, progress, progress*progress, n, progress*n]

def forecast_data():
    """Simulate fictional purchase histories reproducibly; split whole scenarios together."""
    rng = random.Random(20261104)
    rows = []
    for scenario in range(1800):
        split = "train" if scenario%10 < 7 else "validation" if scenario%10 == 7 else "test"
        # Fictional repeated small purchases. This is a simulator, not typical Indian prices.
        scale = math.exp(rng.uniform(math.log(500),math.log(50000)))
        frequency = rng.randint(4,35)
        observed = [(rng.randint(1,30), scale/frequency*rng.lognormvariate(-0.08,0.4))
                    for _ in range(frequency)]
        current = sum(amount for _,amount in observed)
        next_total = current * rng.uniform(0.75,1.25)
        for day in [3,7,15,23,30]:
            partial = [amount for date,amount in observed if date <= day]
            if not partial: continue
            amount = sum(partial)
            rows.append(dict(source="synthetic", group=f"scenario-{scenario}", split=split,
                progress=day/30, count=len(partial), observed=round(amount,2),
                next_month=round(next_total,2)))
    return rows

def solve(matrix, target):
    # Gaussian elimination for a tiny regularized least-squares system.
    rows = [list(row)+[value] for row,value in zip(matrix,target)]
    n = len(rows)
    for col in range(n):
        pivot = max(range(col,n),key=lambda row:abs(rows[row][col]))
        rows[col],rows[pivot] = rows[pivot],rows[col]
        divisor = rows[col][col]
        rows[col] = [v/divisor for v in rows[col]]
        for row in range(n):
            if row == col: continue
            multiplier = rows[row][col]
            rows[row] = [a-multiplier*b for a,b in zip(rows[row],rows[col])]
    return [row[-1] for row in rows]

def fit_forecast(rows, ridge):
    """Fit a regularised linear model for log(next-month spending / observed spending)."""
    matrix=[[0.0]*5 for _ in range(5)]
    target=[0.0]*5
    for row in rows:
        if row["split"] != "train": continue
        x=forecast_features(row["progress"],row["count"])
        y=math.log(row["next_month"]/row["observed"])
        for i in range(5):
            target[i]+=x[i]*y
            for j in range(5): matrix[i][j]+=x[i]*x[j]
    for i in range(5): matrix[i][i]+=ridge
    return solve(matrix,target)

def forecast_amount(row, coefficients, blend=1.0):
    log_ratio=sum(a*b for a,b in zip(forecast_features(row["progress"],row["count"]),coefficients))
    # Guardrail for sparse early-month entries; not a statistically calibrated interval.
    factor=max(1,min(4,math.exp(log_ratio)))
    learned = row["observed"]*factor
    daily = row["observed"]/max(0.1,row["progress"])
    return blend*learned + (1-blend)*daily

def forecast_metrics(rows, coefficients, split, blend=1.0):
    selected=[row for row in rows if row["split"]==split]
    error=lambda prediction: round(sum(abs(prediction(r)-r["next_month"]) for r in selected)/len(selected),2)
    return dict(rows=len(selected),mae_inr=error(lambda r:forecast_amount(r,coefficients,blend)),
                carry_forward_mae_inr=error(lambda r:r["observed"]),
                daily_rate_mae_inr=error(lambda r:r["observed"]/r["progress"]))

def csv_file(path, rows):
    with path.open("w",encoding="utf-8",newline="") as stream:
        writer=csv.DictWriter(stream,fieldnames=list(rows[0]),lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

def main():
    """Select settings on validation data, evaluate test data, and write browser weights."""
    DATA.mkdir(parents=True,exist_ok=True)
    notes=category_data()
    # Choose smoothing and abstention on held-out phrase families.
    candidates=[]
    for smoothing in [0.25,0.5,1.0]:
        candidate=fit_categories(notes,smoothing)
        for threshold in [0.72,0.82,0.90]:
            score=category_metrics(candidate,notes,"validation",threshold)
            if score["accepted_accuracy"] and score["accepted_accuracy"] >= 0.90:
                candidates.append((score["coverage"],threshold,smoothing))
    _,threshold,smoothing=max(candidates,default=(0,0.90,1.0))
    notes_model=fit_categories(notes,smoothing)
    notes_model["minScore"]=threshold
    spending=forecast_data()
    trials=[(forecast_metrics(spending,fit_forecast(spending,r),"validation")["mae_inr"],r) for r in [0.01,0.1,1,10]]
    _,ridge=min(trials)
    coefficients=fit_forecast(spending,ridge)
    # Blend selection is based on validation MAE, not the test split.
    blends=[(forecast_metrics(spending,coefficients,"validation",w)["mae_inr"],w) for w in [0,.25,.5,.75,1]]
    _,blend=min(blends)
    forecast_model=dict(coefficients=coefficients,ridge=ridge,blend=blend,maximumMultiplier=4,
                        features=["intercept","progress","progressSquared","logCount","progressLogCount"])
    artifact=dict(version=1,source="synthetic",trainedOn="2026-11-04",
                  category=notes_model,forecast=forecast_model)
    OUTPUT.write_text("// Rebuild with python ml/train_starter_models.py. Synthetic examples only.\n"
                      +"export const STARTER_MODELS = "+json.dumps(artifact,ensure_ascii=False,separators=(",",":"))+";\n",encoding="utf-8")
    csv_file(DATA/"transaction_notes.csv",notes)
    csv_file(DATA/"spending_scenarios.csv",spending)
    evaluation=dict(source="synthetic-only",real_world_validation=False,
                    seed=20261104,category=category_metrics(notes_model,notes,"test"),
                    forecast=forecast_metrics(spending,coefficients,"test",blend),
                    validation=forecast_metrics(spending,coefficients,"validation",blend),
                    selected_blend=blend,
                    selected_ridge=ridge,
                    sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in DATA.glob("*.csv")},
                    limitations=["Scores cover generated scenarios only, not real users.",
                                 "Phrase families and simulated household scenarios are split as groups.",
                                 "Spending rows assume all simulated purchases were recorded.",
                                 "No saving-action outcomes, India price data, or HCES labels are used."])
    (DATA/"evaluation.json").write_text(json.dumps(evaluation,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(evaluation,indent=2))

if __name__=="__main__":
    main()
