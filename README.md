# Thermometer Reader

Reads temperature from a thermometer via webcam using GPT-4o vision.

## Setup

```bash
export OPENAI_API_KEY="your-api-key"
uv run main.py
```

## Usage

1. Drag mouse to select the thermometer region (green box)
2. Temperature reads automatically every 5 seconds
3. Press `c` to clear crop, `q` to quit

Data saves to `data/run_<timestamp>.csv` with columns: `time`, `temperature`
