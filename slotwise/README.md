# Slotwise – fewer empty chairs (Lund AI Hackathon, challenge 3)

Open `index.html` (clinic) and `book.html` (patient portal) in two tabs side by side. They share state, so a
cancellation in the portal is offered to the waiting list and shows up live in the clinic view.

- **Risk score with explanations**: logistic model, each score broken down into drivers (percentage points).
- **Tiered interventions**: SMS for everyone, a confirm/cancel link for elevated risk, a phone call for high risk (action queue, "Run all").
- **Waiting-list backfill**: a freed slot is offered automatically, priority patients first, then longest wait; if someone declines, the next person gets it.
- **Overbooking suggestions**: only where risk is at least 50%, and staff must accept them.
- **Impact simulator**: Monte Carlo comparison of doing nothing vs. the policy, with adjustable assumptions and SEK value.
- **Model & ethics page**: the score is used to give more support, never less care.

Train on the real data (Kaggle "Medical Appointment No Shows", CC BY-NC-SA 4.0):
`pip install pandas scikit-learn && python train/train.py KaggleV2-May-2016.csv` → writes `model.js`, which the app loads automatically.
